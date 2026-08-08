# Guia Completo de Instalação — Backstage Self-Hosted do Zero

Este guia leva o ambiente do zero absoluto até o Backstage rodando exatamente como está hoje neste projeto: login via SSO (Keycloak), catálogo de software com discovery automático via GitHub, e integração com ArgoCD (incluindo a aba de histórico de deploy na UI).

Ele usa os arquivos **reais e já corrigidos** deste repositório — não os exemplos genéricos dos docs `01` a `05`. Ao longo do caminho, sempre que um passo existe por causa de um bug real que já mordemos, isso é sinalizado com 🐛 e detalhado na [seção 12](#12-problemas-conhecidos-e-soluções) no final.

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Minikube e namespaces](#3-minikube-e-namespaces)
4. [PostgreSQL](#4-postgresql)
5. [Keycloak (SSO)](#5-keycloak-sso)
6. [Construindo a imagem do Backstage](#6-construindo-a-imagem-do-backstage)
7. [ArgoCD](#7-argocd)
8. [Deploy do Backstage no cluster](#8-deploy-do-backstage-no-cluster)
9. [Validação end-to-end](#9-validação-end-to-end)
10. [Catalog discovery via GitHub](#10-catalog-discovery-via-github)
11. [Exercício prático: GitOps de ponta a ponta](#11-exercício-prático-gitops-de-ponta-a-ponta)
12. [Problemas conhecidos e soluções](#12-problemas-conhecidos-e-soluções)

---

## 1. Visão geral da arquitetura

Cinco componentes rodando dentro de um único cluster Kubernetes local (minikube):

```
┌─────────────────────────────────────────────────────────────┐
│                     minikube (1 nó, driver docker)           │
│                                                                │
│  namespace: backstage        namespace: keycloak              │
│  ┌──────────────┐            ┌──────────────┐                │
│  │  Backstage   │◄──OIDC────►│   Keycloak   │                │
│  │  (porta 7007)│            │  (porta 8080)│                │
│  └──────┬───────┘            └──────────────┘                │
│         │                                                     │
│         ▼                     namespace: argocd               │
│  ┌──────────────┐            ┌──────────────┐                │
│  │  PostgreSQL  │            │    ArgoCD    │                │
│  │  (porta 5432)│            │              │                │
│  └──────────────┘            └──────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

- **PostgreSQL** — banco de dados do catálogo, permissões, notificações etc. do Backstage (em produção; localmente o Backstage usa sqlite em memória).
- **Keycloak** — provedor de identidade (SSO via OIDC). Também expõe uma API REST usada para sincronizar usuários/grupos com o catálogo do Backstage.
- **ArgoCD** — motor de GitOps: sincroniza o estado do cluster com o que está declarado em repositórios Git. O Backstage só *lê* o status dele via API.
- **Backstage** — a aplicação em si, construída como uma imagem Docker customizada (não é o Backstage "puro" de fábrica — tem plugins de OIDC, Keycloak, GitHub e ArgoCD já registrados).

Todos os componentes conversam entre si via DNS interno do Kubernetes (`<service>.<namespace>.svc.cluster.local`). O acesso de fora do cluster (seu navegador) é feito via `kubectl port-forward`.

---

## 2. Pré-requisitos

| Ferramenta | Versão usada neste projeto | Observação |
|---|---|---|
| Docker | 24.0+ | Neste ambiente específico: **Docker Desktop** no Windows, não o dockerd nativo do WSL2 — isso importa, ver gotcha 🐛7 |
| kubectl | v1.34.x | |
| Minikube | v1.37.x | driver `docker` |
| Node.js | 22.16.0 | Backstage usa o pacote `isolated-vm` no scaffolder, que tem binários nativos pré-compilados para versões específicas do Node — versões erradas causam falhas de compilação difíceis de diagnosticar |
| Yarn | 4.13.0 (Yarn Berry, via Corepack) | **Não é Yarn Classic** — isso importa bastante no build da imagem, ver gotcha 🐛1 |
| gh CLI | qualquer recente | usado para automações via API do GitHub |
| ArgoCD CLI | v2.13.2 | opcional, dá pra fazer tudo via API/kubectl também |

Ambiente usado: **WSL2 (Ubuntu) + Docker Desktop para Windows + minikube (driver docker) rodando dentro do WSL2**. Essa combinação específica tem uma pegadinha de rede coberta na seção 5.

Ative o Yarn Berry via Corepack:

```bash
corepack enable
```

---

## 3. Minikube e namespaces

```bash
minikube start --driver=docker --memory=6144 --cpus=4

kubectl create namespace backstage
kubectl create namespace keycloak
kubectl create namespace argocd
```

> **Já configurou este lab antes e está retomando depois de desligar o PC?** O minikube roda como um container Docker: quando a máquina desliga, o container para, mas o *profile* (discos, configs, dados) fica salvo. Ao ligar o PC de novo, o `kubectl` ainda aponta para o endereço antigo da API server gravado em `~/.kube/config` — e como não há mais nada escutando ali, qualquer comando `kubectl` falha com algo como:
> ```
> The connection to the server 127.0.0.1:PORTA was refused - did you specify the right host or port?
> ```
> Isso **não** é um problema de variável de ambiente. Basta rodar o mesmo `minikube start` de novo (mesmos flags) — ele sobe o container, reconecta os dados existentes e reescreve o kubeconfig com a porta nova. Os `kubectl create namespace` acima também podem ser reexecutados sem problema (retornam erro "already exists", inofensivo).
>
> **Passo a passo completo pra retomar o lab após desligar/reiniciar o PC:**
> ```bash
> minikube start --driver=docker --memory=6144 --cpus=4
>
> minikube status
> kubectl get all -n backstage
> kubectl get all -n keycloak
> ```
> Desde que o 🐛6 foi corrigido (Keycloak agora tem PVC — seção 5), o realm **sobrevive** ao restart do pod, então não é mais necessário reexecutar `setup-keycloak.sh` nem repatchar o Secret do Backstage a cada boot. O que falta religar são só os `kubectl port-forward` (eles são processos locais, não sobrevivem a um desligamento — ver 🐛11 na seção 12; por decisão dos aprovadores do projeto, esse passo continua manual):
> ```bash
> kubectl port-forward --address 0.0.0.0 svc/keycloak 8082:8080 -n keycloak &
> kubectl port-forward --address 0.0.0.0 svc/backstage 7007:7007 -n backstage &
> ```
> E testar o acesso:
> 1. Acesse `http://localhost:7007`
> 2. Clique em entrar via Keycloak
> 3. Login: `alice.admin` / `password123`
>
> Se mesmo assim o login falhar com erro de realm/client não encontrado (pode acontecer se o *profile* do minikube foi apagado e recriado do zero com `minikube delete`, não só parado/religado — nesse caso o `hostPath` do Keycloak some junto), vá direto para o procedimento do 🐛6 na seção 12.

---

## 4. PostgreSQL

Manifesto único (`k8s/postgres.yaml`) com Secret + PersistentVolume + PersistentVolumeClaim + Deployment + Service:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secrets
  namespace: backstage
type: Opaque
data:
  POSTGRES_USER: YmFja3N0YWdl        # "backstage" em base64
  POSTGRES_PASSWORD: aHVudGVyMg==    # "hunter2" em base64 — senha de laboratório, trocar em uso real
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-storage
  labels:
    type: local
spec:
  storageClassName: manual
  capacity:
    storage: 2Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: '/mnt/data/postgres'
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-storage-claim
  namespace: backstage
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: backstage
  labels:
    backstage.io/kubernetes-id: backstage
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
        backstage.io/kubernetes-id: backstage
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          imagePullPolicy: 'IfNotPresent'
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: postgres-secrets
          volumeMounts:
            - mountPath: /var/lib/postgresql/data
              name: postgresdb
              subPath: postgres
      volumes:
        - name: postgresdb
          persistentVolumeClaim:
            claimName: postgres-storage-claim
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: backstage
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
```

O `hostPath` precisa existir dentro do nó do minikube antes de aplicar:

```bash
minikube ssh "sudo mkdir -p /mnt/data/postgres && sudo chmod 777 /mnt/data/postgres"

kubectl apply -f k8s/postgres.yaml

kubectl wait --for=condition=available --timeout=120s deployment/postgres -n backstage
kubectl exec -it deployment/postgres -n backstage -- psql -U backstage -d postgres -c "SELECT 1"
```

O Postgres **tem** PVC — os dados sobrevivem a reinícios do pod. O Keycloak (próxima seção) também passou a ter, depois do 🐛6.

---

## 5. Keycloak (SSO)

### O gotcha de rede primeiro (🐛7)

Antes de aplicar o manifesto, entenda por que ele tem os campos `KC_HOSTNAME_*`: neste ambiente (WSL2 + Docker Desktop + minikube), **pods dentro do cluster** e **o navegador no Windows** alcançam o Keycloak por caminhos de rede diferentes:

- Pods resolvem `host.docker.internal` de forma confiável via o DNS embutido do Docker Desktop (dinâmico — não tente fixar isso como IP estático em `hostAliases`, já testamos e é instável entre restarts de pod).
- O instalador do Docker Desktop já registra `host.docker.internal` no hosts file do **Windows**, mas apontando para o IP real da máquina na rede local — e o WSL2 só encaminha portas de `kubectl port-forward` via `127.0.0.1`, não via esse IP de LAN.

**Fix aplicado**: sobrescrever, no hosts file do Windows (`C:\Windows\System32\drivers\etc\hosts`), a linha de `host.docker.internal` para apontar pra `127.0.0.1` (sem tocar em `gateway.docker.internal` nem `kubernetes.docker.internal`). Assim `host.docker.internal:8082` fica alcançável tanto pelos pods (DNS nativo) quanto pelo navegador do Windows (hosts file + encaminhamento do WSL2).

### Manifesto (`k8s/keycloak.yaml`)

Desde a correção do 🐛6, o manifesto também tem um PV/PVC (mesmo padrão `hostPath`/`manual` do Postgres, seção 4) montado em `/opt/keycloak/data` — é ali que o modo `start-dev` grava seu banco H2 baseado em arquivo, então persistir esse caminho é suficiente pra sobreviver a um restart do pod. O `initContainer` só garante a permissão de escrita do grupo nesse diretório (a imagem do Keycloak roda como uid 1000/gid 0).

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: keycloak-secrets
  namespace: keycloak
type: Opaque
stringData:
  KEYCLOAK_ADMIN_PASSWORD: "keycloak-admin-1234"
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: keycloak-storage
  labels:
    type: local
spec:
  storageClassName: manual
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: '/mnt/data/keycloak'
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: keycloak-storage-claim
  namespace: keycloak
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: keycloak
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      initContainers:
        - name: fix-permissions
          image: busybox:1.36
          command: ['sh', '-c', 'chmod -R g+rwX /data']
          securityContext:
            runAsUser: 0
          volumeMounts:
            - mountPath: /data
              name: keycloak-data
              subPath: keycloak-data
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:24.0
          args:
            - start-dev
          env:
            - name: KEYCLOAK_ADMIN
              value: admin
            - name: KEYCLOAK_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: keycloak-secrets
                  key: KEYCLOAK_ADMIN_PASSWORD
            - name: KC_PROXY_HEADERS
              value: "xforwarded"
            - name: KC_HTTP_ENABLED
              value: "true"
            - name: KC_HEALTH_ENABLED
              value: "true"
            - name: KC_HOSTNAME_URL
              value: "http://host.docker.internal:8082"
            - name: KC_HOSTNAME_STRICT
              value: "true"
            - name: KC_HOSTNAME_STRICT_BACKCHANNEL
              value: "true"
          ports:
            - containerPort: 8080
          volumeMounts:
            - mountPath: /opt/keycloak/data
              name: keycloak-data
              subPath: keycloak-data
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 3
      volumes:
        - name: keycloak-data
          persistentVolumeClaim:
            claimName: keycloak-storage-claim
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: keycloak
spec:
  selector:
    app: keycloak
  ports:
    - port: 8080
      targetPort: 8080
```

O `hostPath` precisa existir dentro do nó do minikube antes de aplicar (mesma observação do Postgres, seção 4):

```bash
minikube ssh "sudo mkdir -p /mnt/data/keycloak && sudo chmod 777 /mnt/data/keycloak"

kubectl apply -f k8s/keycloak.yaml
kubectl wait --for=condition=available --timeout=180s deployment/keycloak -n keycloak

# porta 8082 localmente -> 8080 no pod. --address 0.0.0.0 é necessário para
# que os PODS (não só o navegador) também consigam alcançar via host.docker.internal:8082
kubectl port-forward --address 0.0.0.0 svc/keycloak 8082:8080 -n keycloak &
```

### Realm, client, grupos e usuário (`k8s/setup-keycloak.sh`)

Este script automatiza tudo via API REST do Keycloak: cria o realm `backstage`, o client OIDC confidencial `backstage`, três grupos (`platform-admins`, `developers`, `viewers`), o usuário de teste `alice.admin`, o mapper que inclui `groups` no token, e a role `view-users` para a service account do client (usada pela sincronização de usuários do Backstage).

```bash
chmod +x k8s/setup-keycloak.sh
./k8s/setup-keycloak.sh
```

Ao final, o script imprime o **client secret** gerado — guarde esse valor, ele vai para o Secret do Backstage na seção 8.

### 🐛6 — Sem storage persistente (RESOLVIDO)

O manifesto do Keycloak **não tinha PVC nenhum** originalmente (`start-dev` grava tudo num banco H2 baseado em arquivo em `/opt/keycloak/data` — não é literalmente em memória, só não estava num disco persistido). Consequência prática: **todo restart do pod do Keycloak apagava o realm inteiro** — client, grupos, usuário, tudo, inclusive todo restart disparado por um simples `minikube start` depois de desligar o PC.

**Corrigido** adicionando o PV/PVC mostrado acima, montado em `/opt/keycloak/data`. Testado forçando a exclusão do pod (`kubectl delete pod -n keycloak -l app=keycloak`) e confirmando que `GET /realms/backstage` continua respondendo 200 depois que o pod novo sobe — o realm sobrevive.

Se **mesmo assim** o realm sumir depois de um restart, o procedimento de recuperação continua o mesmo de antes (útil também se o `hostPath` for perdido por um `minikube delete`, não só um `stop`/`start`):

1. Reabrir o port-forward da 8082 (se caiu)
2. Rodar `./k8s/setup-keycloak.sh` de novo
3. Pegar o novo `CLIENT SECRET` impresso no final
4. Atualizar o Secret do Backstage (`KEYCLOAK_CLIENT_SECRET`) com esse novo valor
5. Reiniciar o deployment do Backstage

---

## 6. Construindo a imagem do Backstage

Esta é a parte mais densa. Os arquivos abaixo definem **o que o Backstage faz** — plugins registrados, autenticação, integrações.

### 6.1 `packages/backend/src/index.ts`

```ts
import { createBackend } from '@backstage/backend-defaults';
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { oidcAuthenticator } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  stringifyEntityRef,
  DEFAULT_NAMESPACE,
} from '@backstage/catalog-model';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-notifications'));

// techdocs plugin
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// NOTA: NÃO fazemos backend.add() do módulo oidc-provider inteiro — ele se
// auto-registraria como provider padrão 'oidc' e colidiria com o provider
// customizado registrado abaixo. Só o authenticator é importado e reutilizado.
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

// Login via Keycloak OIDC: o usuário precisa já existir no catálogo
// (sincronizado pelo catalog-backend-module-keycloak abaixo), então a posse
// de grupo vem de relações reais do catálogo, não de claims manuais.
const keycloakAuthModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'keycloak-oidc-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'oidc',
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            async signInResolver(info, ctx) {
              const { preferred_username, sub } = info.result.fullProfile.userinfo;
              const name = preferred_username ?? sub;
              try {
                return await ctx.signInWithCatalogUser({
                  entityRef: { name },
                });
              } catch {
                // Fallback: identidade efêmera se a sincronização do Keycloak
                // ainda não pegou esse usuário.
                const userRef = stringifyEntityRef({
                  kind: 'User',
                  name,
                  namespace: DEFAULT_NAMESPACE,
                });
                return ctx.issueToken({
                  claims: { sub: userRef, ent: [userRef] },
                });
              }
            },
          }),
        });
      },
    });
  },
});
backend.add(keycloakAuthModule);

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'));

// discovery de catálogo via GitHub
backend.add(import('@backstage/plugin-catalog-backend-module-github'));

// sincronização de usuários/grupos do Keycloak
backend.add(import('@backstage-community/plugin-catalog-backend-module-keycloak'));

backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'));

// search plugin
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-pg'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// kubernetes plugin
backend.add(import('@backstage/plugin-kubernetes-backend'));

// user settings, notifications, signals, mcp actions
backend.add(import('@backstage/plugin-user-settings-backend'));
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// ArgoCD
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));

backend.start();
```

Este arquivo materializa os gotchas 🐛2 (comentário explícito sobre não registrar o módulo oidc-provider inteiro).

### 6.2 `packages/app/src/App.tsx` e `apis.tsx`

Este projeto usa o **New Frontend System** do Backstage (`@backstage/frontend-defaults`), não o formato antigo `createApp({apis, plugins})`.

```tsx
// App.tsx
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
import { navModule } from './modules/nav';
import { authModule } from './apis';

export default createApp({
  features: [catalogPlugin, argoCdPlugin, navModule, authModule],
});
```

```tsx
// apis.tsx — Api do Keycloak (OAuth2) + página de login customizada
import {
  OpenIdConnectApi, ProfileInfoApi, BackstageIdentityApi, SessionApi,
} from '@backstage/core-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { SignInPage } from '@backstage/core-components';
import {
  createApiRef, createFrontendModule, configApiRef,
  discoveryApiRef, oauthRequestApiRef, ApiBlueprint,
} from '@backstage/frontend-plugin-api';

export const keycloakAuthApiRef = createApiRef<
  OpenIdConnectApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>().with({ id: 'auth.keycloak' });

const keycloakAuthApi = ApiBlueprint.make({
  name: 'keycloak',
  params: defineParams =>
    defineParams({
      api: keycloakAuthApiRef,
      deps: { discoveryApi: discoveryApiRef, oauthRequestApi: oauthRequestApiRef, configApi: configApiRef },
      factory: ({ discoveryApi, oauthRequestApi, configApi }) =>
        OAuth2.create({
          configApi, discoveryApi, oauthRequestApi,
          environment: configApi.getOptionalString('auth.environment'),
          provider: { id: 'oidc', title: 'Keycloak', icon: () => null },
          // 'groups' NÃO é pedido como scope OAuth de propósito — ver gotcha 🐛5
          defaultScopes: ['openid', 'profile', 'email'],
        }),
    }),
});

const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => props => (
      <SignInPage
        {...props}
        provider={{ id: 'keycloak-auth-provider', title: 'Keycloak', message: 'Sign In using Keycloak', apiRef: keycloakAuthApiRef }}
      />
    ),
  },
});

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [keycloakAuthApi, signInPage],
});
```

O `navModule` (sidebar customizada) é só estética — em `src/modules/nav/`, opcional de reproduzir.

### 6.3 Configuração: `app-config.yaml` (dev) vs `app-config.production.yaml` (produção)

`app-config.yaml` é a config base — usada tanto localmente (`yarn start`) quanto como fallback embutido na imagem Docker. Pontos que existem por causa de bugs:

```yaml
# O plugin argocd-backend da roadiehq exige essa chave no startup (mesmo
# vazia) ou o processo inteiro do backend morre. Instâncias reais vêm do
# app-config.production.yaml / ConfigMap de deploy. -> gotcha 🐛3
argocd:
  appLocatorMethods: []
```

`k8s/app-config.production.yaml` é o overlay com as integrações reais (tudo via variável de ambiente — os valores concretos vêm do Secret do Kubernetes, seção 8):

```yaml
auth:
  environment: production
  session:
    secret: ${AUTH_SESSION_SECRET}
  providers:
    guest: {}
    oidc:
      production:
        metadataUrl: ${KEYCLOAK_METADATA_URL}
        clientId: ${KEYCLOAK_CLIENT_ID}
        clientSecret: ${KEYCLOAK_CLIENT_SECRET}
        prompt: auto   # <- gotcha 🐛4: default é "none", que quebra login manual

catalog:
  providers:
    keycloakOrg:
      default:
        baseUrl: ${KEYCLOAK_BASE_URL}
        loginRealm: ${KEYCLOAK_REALM}
        realm: ${KEYCLOAK_REALM}
        clientId: ${KEYCLOAK_CLIENT_ID}
        clientSecret: ${KEYCLOAK_CLIENT_SECRET}
        schedule: { frequency: { minutes: 30 }, timeout: { minutes: 3 } }
    github:
      default:
        organization: ${GITHUB_ORG}   # funciona com conta pessoal -> gotcha 🐛8
        catalogPath: '/catalog-info.yaml'
        schedule: { frequency: { minutes: 30 }, timeout: { minutes: 3 } }

argocd:
  username: ${ARGOCD_USERNAME}
  password: ${ARGOCD_PASSWORD}
  revisionsToLoad: 10   # <- gotcha 🐛10, NÃO deixe no default (-1)
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: default
          url: ${ARGOCD_URL}
          token: ${ARGOCD_AUTH_TOKEN}
```

**Importante sobre como essas duas configs se combinam de fato**: dentro do container, o `Dockerfile` só empacota `app-config.yaml` (config de dev). O que faz a config de *produção* valer de verdade não é a flag padrão `--config app-config.production.yaml` do Backstage — é o **ConfigMap montado por cima do mesmo caminho** (`/app/app-config.yaml`, ver seção 8), substituindo o conteúdo do arquivo original por essas configurações de produção. Ou seja: o ConfigMap do cluster é a fonte de verdade real, não o `k8s/app-config.production.yaml` do repo por si só (mantenha os dois sincronizados manualmente).

### 6.4 `docker/Dockerfile` (🐛1 — Yarn Berry)

```dockerfile
# --- Estágio 1: Build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make curl git && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN yarn install --frozen-lockfile || yarn install
RUN yarn tsc
RUN yarn --cwd packages/backend build

# --- Estágio 2: Imagem Final ---
FROM node:22-bookworm-slim AS final
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# 1. Copia arquivos de configuração do Yarn Berry (essencial, ver abaixo)
COPY --from=build /app/.yarnrc* ./
COPY --from=build /app/.yarn ./.yarn

# 2. Copia yarn.lock, package.json e extrai a estrutura do skeleton
COPY --from=build /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

# 3. Instala só as dependências de produção — sintaxe correta pro Yarn Berry
RUN yarn workspaces focus --all --production

# 4. Copia e extrai o bundle da aplicação
COPY --from=build /app/packages/backend/dist/bundle.tar.gz ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# 5. Config + permissões
COPY app-config.yaml ./
RUN chown -R node:node /app
USER node

CMD ["node", "packages/backend/dist/index.cjs.js", "--config", "app-config.yaml"]
```

Por que isso importa: a versão anterior desse Dockerfile usava `yarn install --production --frozen-lockfile` — sintaxe do **Yarn Classic**, inválida no Yarn Berry 4.13 configurado por `.yarnrc.yml` — e nem copiava `.yarnrc*`/`.yarn`/`yarn.lock` pro estágio final, então o Yarn não tinha como resolver o workspace de jeito nenhum. Ver gotcha 🐛1 para o detalhe completo.

### 6.5 Build e carregamento no minikube

```bash
docker build -t backstage:1.0.0 -f docker/Dockerfile .    # leva ~5-7 minutos
minikube image load backstage:1.0.0
minikube image ls | grep backstage   # confirma que carregou
```

### 🐛14 — `minikube image load` não atualiza uma tag já existente

Se `backstage:1.0.0` **já foi carregado antes** (ex.: você rebuildou a imagem depois de mudar código), rodar `minikube image load backstage:1.0.0` de novo **não substitui** a imagem antiga dentro do minikube — ele silenciosamente não faz nada, mesmo com `--overwrite=true`. `minikube image ls` mostra a tag presente, então parece que carregou, mas o `IMAGE ID`/`CreatedAt` continuam sendo os da build anterior. Resultado: você reinicia o deployment, o rollout termina "com sucesso", mas o app continua servindo o código antigo — sem nenhum erro visível.

**Como confirmar que é isso**: compare o ID da imagem local com o que está de fato dentro do minikube:
```bash
docker images backstage:1.0.0 --format '{{.ID}} {{.CreatedAt}}'
minikube ssh -- "docker images backstage:1.0.0 --format '{{.ID}} {{.CreatedAt}}'"
```
Se os IDs forem diferentes, o minikube está com a imagem velha.

**Correção**: remover a tag de dentro do minikube antes de carregar de novo (só funciona se nenhum pod estiver usando essa imagem no momento — troque o deployment pra outra tag temporária primeiro se precisar):
```bash
minikube image rm backstage:1.0.0
minikube image load backstage:1.0.0
kubectl rollout restart deployment/backstage -n backstage
```
Alternativa mais simples pra evitar esse problema por completo: usar uma tag nova a cada rebuild (`backstage:1.0.1`, um hash curto do commit, etc.) em vez de reaproveitar `1.0.0` sempre — elimina a ambiguidade de vez, ao custo de ter que atualizar a tag no Deployment a cada vez.

---

## 7. ArgoCD

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.2/manifests/install.yaml

kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd
kubectl wait --for=condition=available --timeout=300s deployment/argocd-repo-server -n argocd
kubectl wait --for=condition=available --timeout=300s deployment/argocd-applicationset-controller -n argocd

# HTTP sem TLS (lab local) + habilita API Keys
kubectl patch configmap argocd-cmd-params-cm -n argocd --type merge -p '{"data":{"server.insecure":"true"}}'
kubectl patch configmap argocd-cm -n argocd --type merge -p '{"data":{"accounts.admin":"apiKey"}}'

kubectl rollout restart deployment/argocd-server -n argocd
kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd
```

### Gerando o token de sessão (🐛9 — vai expirar)

```bash
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

ARGOCD_TOKEN=$(kubectl run argocd-token-generator --rm -i --restart=Never --image=curlimages/curl:latest -- \
  curl -sk -X POST http://argocd-server.argocd.svc.cluster.local/api/v1/session \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$ARGOCD_PASSWORD\"}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

Esse é um token de **sessão** (JWT com expiração), não uma credencial permanente — trate a regeneração como parte da operação normal do lab, não como troubleshooting excepcional (procedimento completo na seção 12).

---

## 8. Deploy do Backstage no cluster

### RBAC (para o plugin Kubernetes conseguir listar recursos)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: backstage
  namespace: backstage
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: backstage-read
rules:
  - apiGroups: ['*']
    resources:
      - pods
      - pods/log
      - configmaps
      - services
      - deployments
      - replicasets
      - horizontalpodautoscalers
      - ingresses
      - statefulsets
      - limitranges
      - resourcequotas
      - persistentvolumeclaims
      - daemonsets
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: backstage-read
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: backstage-read
subjects:
  - kind: ServiceAccount
    name: backstage
    namespace: backstage
```

```bash
kubectl apply -f backstage-rbac.yaml
```

### Secret com todas as credenciais

Chaves usadas hoje neste ambiente (nomes exatos, conferidos direto no cluster):

```
POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD
KEYCLOAK_BASE_URL, KEYCLOAK_METADATA_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET
GITHUB_TOKEN, GITHUB_USERNAME, GITHUB_ORG
ARGOCD_URL, ARGOCD_AUTH_TOKEN
AUTH_SESSION_SECRET
```

```bash
kubectl create secret generic backstage-secrets -n backstage \
  --from-literal=POSTGRES_HOST=postgres \
  --from-literal=POSTGRES_PORT=5432 \
  --from-literal=POSTGRES_USER=backstage \
  --from-literal=POSTGRES_PASSWORD=hunter2 \
  --from-literal=KEYCLOAK_BASE_URL=http://keycloak.keycloak.svc.cluster.local:8080 \
  --from-literal=KEYCLOAK_METADATA_URL=http://host.docker.internal:8082/realms/backstage/.well-known/openid-configuration \
  --from-literal=KEYCLOAK_REALM=backstage \
  --from-literal=KEYCLOAK_CLIENT_ID=backstage \
  --from-literal=KEYCLOAK_CLIENT_SECRET='<client secret do k8s/setup-keycloak.sh>' \
  --from-literal=GITHUB_TOKEN='<PAT com escopo repo>' \
  --from-literal=GITHUB_USERNAME='<seu usuário>' \
  --from-literal=GITHUB_ORG='<seu usuário ou org — ambos funcionam, gotcha 🐛8>' \
  --from-literal=ARGOCD_URL=http://argocd-server.argocd.svc.cluster.local \
  --from-literal=ARGOCD_AUTH_TOKEN="$ARGOCD_TOKEN" \
  --from-literal=AUTH_SESSION_SECRET="$(openssl rand -base64 32)"
```

⚠️ Nunca cole um PAT do GitHub em texto puro num arquivo versionado — ver gotcha correlato na seção 12 sobre o incidente real que motivou essa nota.

### ConfigMap com a config de produção

```bash
kubectl create configmap backstage-config \
  --from-file=app-config.yaml=k8s/app-config.production.yaml \
  -n backstage \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Deployment e Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backstage
  namespace: backstage
  labels:
    backstage.io/kubernetes-id: backstage
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backstage
  template:
    metadata:
      labels:
        app: backstage
        backstage.io/kubernetes-id: backstage
    spec:
      serviceAccountName: backstage
      containers:
        - name: backstage
          image: backstage:1.0.0
          imagePullPolicy: Never   # imagem só existe local no node do minikube
          ports:
            - containerPort: 7007
          env:
            - name: NODE_OPTIONS
              value: "--no-node-snapshot"
          envFrom:
            - secretRef:
                name: backstage-secrets
          volumeMounts:
            - name: techdocs
              mountPath: /app/techdocs
            - name: backstage-config
              mountPath: /app/app-config.yaml
              subPath: app-config.yaml
      volumes:
        - name: techdocs
          emptyDir: {}
        - name: backstage-config
          configMap:
            name: backstage-config
---
apiVersion: v1
kind: Service
metadata:
  name: backstage
  namespace: backstage
spec:
  selector:
    app: backstage
  ports:
    - name: http
      port: 7007
      targetPort: 7007
```

```bash
kubectl apply -f backstage-deployment.yaml
kubectl rollout status deployment/backstage -n backstage --timeout=120s

kubectl port-forward --address 0.0.0.0 svc/backstage 7007:7007 -n backstage &
```

---

## 9. Validação end-to-end

1. Acesse `http://localhost:7007`
2. Clique em entrar via Keycloak
3. Login: `alice.admin` / `password123`
4. Confira o **Catalog** — deve aparecer vazio na primeira vez (ninguém foi descoberto ainda)
5. Confira que não há erros nos logs: `kubectl logs -n backstage deployment/backstage --tail=50`

---

## 10. Catalog discovery via GitHub

Com `GITHUB_TOKEN` (escopo `repo`) e `GITHUB_ORG` configurados (seção 8), o backend varre automaticamente todos os repositórios do usuário/org a cada 30 minutos, procurando um `catalog-info.yaml` na raiz do branch padrão de cada um.

🐛8: apesar do nome do campo ser `organization`, a implementação (`GithubEntityProvider`) usa a query GraphQL `repositoryOwner(login: $org)`, que o GitHub resolve tanto para orgs quanto para contas de usuário pessoal — não é preciso ter uma org.

Para um repositório aparecer no catálogo, ele precisa de um `catalog-info.yaml` na raiz:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: nome-do-repo
  description: descrição curta
spec:
  type: service   # ou 'infrastructure', 'library', etc.
  lifecycle: experimental
  owner: group:default/platform-admins
```

Depois de mergear esse arquivo na branch padrão, force um novo ciclo de discovery reiniciando o pod (ou espere os 30 minutos):

```bash
kubectl rollout restart deployment/backstage -n backstage
```

---

## 11. Exercício prático: GitOps de ponta a ponta

Ótimo exercício de aula — mostra o ciclo GitOps inteiro ao vivo, do `git push` até aparecer na UI do Backstage.

**1. Repositório mínimo** (sem dependência de nuvem — só um nginx de exemplo), com dois arquivos:

`manifests/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-nginx
spec:
  replicas: 2
  selector:
    matchLabels: { app: demo-nginx }
  template:
    metadata:
      labels: { app: demo-nginx }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: demo-nginx
spec:
  selector: { app: demo-nginx }
  ports: [{ port: 80, targetPort: 80 }]
```

`catalog-info.yaml` (na raiz do repo, anotado para linkar com o ArgoCD):
```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: nome-do-repo-demo
  annotations:
    argocd/app-name: nome-do-repo-demo
spec:
  type: service
  lifecycle: experimental
  owner: group:default/platform-admins
```

**2. Application do ArgoCD**, apontando pro repositório:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nome-do-repo-demo
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<seu-usuario>/nome-do-repo-demo.git
    targetRevision: main
    path: manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: demo
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

```bash
kubectl apply -f argocd-demo-app.yaml
kubectl get application nome-do-repo-demo -n argocd -o jsonpath='{.status.sync.status} / {.status.health.status}'
```

> Um exemplo real e versionado desse manifesto (com os placeholders já substituídos pelos valores usados neste lab) está em `k8s/argocd-demo-app.yaml`. O roteiro completo de demonstração — 4 janelas de terminal, port-forwards, `k9s` acompanhando as réplicas ao vivo — está em `docs/Explicacao secao 11 - Teste pratico GitOps ao vivo (k9s + port-forwards).md`.

**3. Validação**: espere sincronizar (`Synced` / `Healthy`), force o discovery do Backstage (seção 10), abra o componente no Catalog → aba **ArgoCD** → deve mostrar o histórico de deploy real, com commit e data.

Para demonstrar o ciclo completo em aula: edite `manifests/deployment.yaml` (ex.: `replicas: 3`), dê push, e mostre o ArgoCD detectando e aplicando sozinho — sem ninguém rodar `kubectl apply`.

---

## 12. Problemas conhecidos e soluções

### 🐛1 — Build da imagem falha com Yarn Berry
**Sintoma**: `docker build` falha no estágio final com erro de sintaxe do Yarn ou dependências não resolvidas.
**Causa**: `yarn install --production --frozen-lockfile` é sintaxe do Yarn **Classic**; este projeto usa Yarn **Berry** (4.13, configurado via `.yarnrc.yml`), que não reconhece essas flags. Além disso, o estágio final não copiava `.yarnrc.yml`/`.yarn`/`yarn.lock`, então o Yarn nem tinha como resolver o workspace.
**Correção**: usar `yarn workspaces focus --all --production` (equivalente correto no Berry), e copiar `.yarnrc*`, `.yarn`, `yarn.lock` + `package.json` para o estágio final antes de extrair o skeleton. Ver `docker/Dockerfile` neste repo.

### 🐛2 — `Error: Auth provider 'oidc' was already registered`
**Sintoma**: backend não sobe, erro de provider duplicado.
**Causa**: `backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'))` se auto-registra como provider padrão `oidc`, colidindo com um provider customizado registrado via `authProvidersExtensionPoint`.
**Correção**: nunca dar `backend.add()` no módulo inteiro quando for usar um provider customizado — importar só o `oidcAuthenticator` e reutilizá-lo. Ver `packages/backend/src/index.ts`.

### 🐛3 — Backend inteiro crasha no startup por causa do ArgoCD
**Sintoma**: o processo do backend morre ao iniciar, sem log claro do motivo real.
**Causa**: `@roadiehq/backstage-plugin-argo-cd-backend` lê `argocd.appLocatorMethods` de forma incondicional no startup — se a chave não existir na config (nem vazia), ele derruba o processo inteiro, não só se autodesabilita.
**Correção**: manter `argocd: { appLocatorMethods: [] }` sempre presente em `app-config.yaml`, mesmo em ambientes que não usam ArgoCD.

### 🐛4 — Login trava com popup piscando e fechando (`login_required`)
**Sintoma**: clicar em "Sign in" abre e fecha o popup do Keycloak instantaneamente, sem mostrar a tela de login.
**Causa**: `oidcAuthenticator` usa `prompt: "none"` por padrão, que nunca mostra formulário de login — só funciona pra checagem silenciosa de sessão já existente.
**Correção**: `auth.providers.oidc.production.prompt: auto` explicitamente.

### 🐛5 — `invalid_scope` do Keycloak
**Sintoma**: erro `invalid_scope` ao tentar logar.
**Causa**: pedir `groups` como scope OAuth sem ter um *client scope* Keycloak com esse nome criado.
**Correção**: não pedir `groups` no `defaultScopes` do frontend — o mapper de group-membership já foi anexado direto ao client pelo `setup-keycloak.sh`, então os grupos vêm no token independente do scope pedido.

### 🐛6 — Realm do Keycloak sumiu depois de um restart (RESOLVIDO)
**Sintoma**: login para de funcionar do nada, erro de realm/client não encontrado — tipicamente depois de `minikube start` após desligar o PC.
**Causa**: Keycloak rodava em modo `start-dev` sem PVC — reinício do pod apagava tudo.
**Correção**: `k8s/keycloak.yaml` agora tem PV/PVC montado em `/opt/keycloak/data` (detalhes e YAML completo na seção 5). O realm sobrevive a restart de pod desde então — validado forçando `kubectl delete pod` no Keycloak e confirmando que o realm continua respondendo.
**Se voltar a acontecer** (ex.: `minikube delete` apaga o `hostPath` junto): reabrir port-forward na 8082, rodar `./k8s/setup-keycloak.sh` de novo, atualizar `KEYCLOAK_CLIENT_SECRET` no Secret do Backstage, reiniciar o deployment do Backstage, e **reabrir também o port-forward do Backstage (7007)** — o `rollout restart` mata o pod antigo e derruba junto qualquer port-forward que apontava pra ele (ver 🐛11).

### 🐛7 — Backend não alcança o Keycloak / navegador não alcança o Keycloak
**Sintoma**: um dos dois lados (pods ou navegador) consegue falar com `host.docker.internal:8082`, o outro não.
**Causa**: split-horizon DNS entre WSL2, Docker Desktop e o hosts file do Windows (detalhe completo na seção 5).
**Correção**: sobrescrever `host.docker.internal` → `127.0.0.1` no hosts file do Windows.

### 🐛8 — Discovery do GitHub não funciona com conta pessoal
**Sintoma**: presunção de que `GITHUB_ORG` só funciona com uma organização de verdade do GitHub.
**Realidade**: a implementação usa `repositoryOwner(login: $org)` via GraphQL, que funciona igual para contas de usuário pessoal — não é necessário criar uma org.

### 🐛9 — Aba do ArgoCD/dados do ArgoCD param de carregar
**Sintoma**: chamadas à API do ArgoCD retornam 401.
**Causa**: `ARGOCD_AUTH_TOKEN` é um token de **sessão** (JWT com expiração), não uma credencial permanente.
**Correção**: regenerar via `argocd-initial-admin-secret` + `POST /api/v1/session` (comandos na seção 7), repatchar o Secret, reiniciar o Backstage.

### 🐛10 — Aba "ArgoCD" do componente aparece em branco, sem erro nenhum
**Sintoma**: aba carrega, sem erro no console, mas não mostra nenhuma linha de histórico.
**Causa**: bug do plugin `@roadiehq/backstage-plugin-argo-cd` — internamente faz `history.slice(0, revisionsToLoad)`, e o default de `revisionsToLoad` é `-1`. Em JavaScript, `array.slice(0, -1)` significa "tudo menos o último item" — com apenas 1 sync no histórico (comum em apps recém-criadas), isso remove o único item e sobra um array vazio.
**Correção**: configurar `argocd.revisionsToLoad` explicitamente com um número positivo (ex.: `10`) em vez de deixar no default.

### 🐛11 — `kubectl port-forward` cai sozinho depois de qualquer restart de pod
**Sintoma**: uma aba do navegador que estava funcionando (Backstage, ArgoCD UI, Keycloak) de repente para de responder — `ERR_CONNECTION_REFUSED` — sem que ninguém tenha fechado o terminal do port-forward.
**Causa**: `kubectl port-forward svc/X` resolve o Service para um pod específico **no momento em que o comando é executado** e mantém o túnel preso ao IP daquele pod — não é redirecionado pelo Service como o tráfego normal do cluster. Qualquer evento que troque o pod por trás do Service (`kubectl rollout restart`, um crash, uma atualização de imagem, ou o pod simplesmente reiniciar por qualquer motivo — inclusive como consequência do 🐛6 ou de religar o minikube) derruba o túnel silenciosamente, mesmo que o Service continue saudável.
**Correção**: não tem como evitar — é o comportamento esperado do `port-forward`. Sempre que reiniciar um deployment que tem port-forward ativo, reabra o port-forward correspondente logo em seguida. Se estiver rodando em background (`&`), rode `ps aux | grep port-forward` para conferir se o processo antigo ainda está vivo antes de assumir que só falta recarregar a página.

**Variante sem restart de pod, importante pra apresentações/demos ao vivo**: o túnel também pode cair sozinho **mesmo sem nenhum pod reiniciar** — o log mostra `socat[...] E write(...): Broken pipe` / `error: lost connection to pod`. Causa: `port-forward` é uma única conexão de longa duração passando por vários saltos (`kubectl` → API server → kubelet → container runtime → pod); qualquer soluço transitório em qualquer um desses saltos derruba o túnel, e o comando **não tenta reconectar sozinho**. Neste ambiente (WSL2 + Docker Desktop + minikube) esse caminho é mais longo que um Kubernetes "de verdade", e fica mais sujeito a isso quando a máquina está sob carga (ex.: um `docker build` rodando em paralelo). Pra qualquer port-forward que precise ficar de pé durante uma apresentação, use um loop de retry em vez do comando puro:
```bash
while true; do
  kubectl port-forward --address 0.0.0.0 svc/<nome> -n <namespace> <porta>:<porta>
  echo "caiu, reconectando em 2s..."
  sleep 2
done
```
Assim uma queda vira uma piscada de ~2s na tela em vez de exigir intervenção manual no meio da demo.

### 🐛12 — Botão "Create" mostra "No templates found" mesmo com o template configurado
**Sintoma**: `catalog.locations` aponta certinho pro `examples/template/template.yaml`, mas a tela de Create não lista nenhum template.
**Causa**: dupla. (1) O `docker/Dockerfile` original nunca copiava a pasta `examples/` pra imagem final — só o bundle do backend e o `app-config.yaml`, então `/app/examples/` nem existia dentro do container. (2) Mesmo copiando, os caminhos herdados do `app-config.yaml` de dev (`../../examples/...`) resolvem errado dentro do container: esse `../../` é a convenção de quando o backend roda de dentro de `packages/backend/` no monorepo local; dentro da imagem o processo roda direto de `/app`, então o caminho certo é `./examples/...`.
**Correção**: adicionar `COPY --from=build /app/examples ./examples` no estágio final do `docker/Dockerfile`, e usar `./examples/...` (não `../../examples/...`) nas `catalog.locations` de `k8s/app-config.production.yaml`. Ao investigar isso também foi descoberto que o ConfigMap `backstage-config` ao vivo no cluster estava bem diferente do arquivo `k8s/app-config.production.yaml` do repositório (alguém tinha editado o ConfigMap direto, sem sincronizar de volta) — os dois foram resincronizados.

### 🐛13 — Login com Keycloak trava com `ECONNREFUSED` mesmo com o Keycloak acessível
**Sintoma**: `Sign in` retorna erro 500 em `/api/auth/oidc/start` com `"code":"ECONNREFUSED"`, mesmo confirmando que `curl http://localhost:8082` e o Keycloak respondem normalmente.
**Causa**: o cliente OIDC do backend faz a descoberta do provedor (`metadataUrl`) **uma vez, na inicialização do processo**. Se o port-forward do Keycloak (porta 8082) estiver fora do ar bem nesse instante — por exemplo, caiu por causa do 🐛11 pouco antes do pod do Backstage subir — essa descoberta falha, e o cliente fica preso nesse estado quebrado pelo resto da vida do processo, mesmo que a conectividade volte ao normal segundos depois.
**Correção**: garantir que o port-forward do Keycloak já esteja de pé *antes* de reiniciar/religar o Backstage. Se o erro já aconteceu, não adianta só reabrir o port-forward — é necessário `kubectl rollout restart deployment/backstage -n backstage` pra forçar uma nova tentativa de descoberta com o Keycloak já acessível.

### 🐛14 — Rebuild da imagem do Backstage não aparece no cluster, sem erro nenhum
**Sintoma**: você muda código do frontend/backend, roda `docker build` + `minikube image load` + `kubectl rollout restart` de novo, tudo "funciona" (rollout termina com sucesso, pod sobe saudável), mas o app continua se comportando como a versão antiga.
**Causa**: `minikube image load <tag>` não substitui uma imagem já carregada com a mesma tag — fica em silêncio, sem erro, mesmo passando `--overwrite=true`. `minikube image ls` mostra a tag lá, mas o conteúdo por trás dela é o da build anterior.
**Correção**: comparar o `IMAGE ID` local com o de dentro do minikube (`docker images backstage:1.0.0 --format '{{.ID}}'` vs `minikube ssh -- "docker images backstage:1.0.0 --format '{{.ID}}'"`) pra confirmar o diagnóstico; depois `minikube image rm backstage:1.0.0` antes de recarregar. Detalhes e comandos completos na seção 6.5.

### Nota de segurança — PAT do GitHub em texto puro
Durante o desenvolvimento deste lab, um PAT real do GitHub chegou a ficar em texto puro dentro de um arquivo de anotações não versionado. Ele foi rotacionado (token antigo revogado, novo gerado com expiração definida) e o arquivo foi redigido antes de qualquer commit. **Nunca** deixe tokens reais em arquivos que podem ser commitados — prefira sempre passar por variável de ambiente / Secret do Kubernetes, como este guia faz em todos os passos.
