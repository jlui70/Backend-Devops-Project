# Backend DevOps Project — Backstage Self-Hosted

Um Internal Developer Portal ([Backstage](https://backstage.io)) self-hosted do zero, com autenticação corporativa (SSO), catálogo de software com discovery automático e GitOps — tudo rodando localmente em Kubernetes (minikube), sem depender de nenhum serviço gerenciado de nuvem.

Projeto construído como material de laboratório para o curso de **Platform Engineering / DevOps**, cobrindo na prática os pilares de uma plataforma interna: identidade, catálogo de serviços, e entrega contínua declarativa.

## Stack

| Componente | Papel |
|---|---|
| [Backstage](https://backstage.io) | Portal do desenvolvedor — imagem Docker customizada com plugins de OIDC, Keycloak, GitHub e ArgoCD |
| [Keycloak](https://www.keycloak.org/) | Identity Provider — SSO via OIDC, sincronização de usuários/grupos com o catálogo |
| [PostgreSQL](https://www.postgresql.org/) | Banco de dados do Backstage em produção |
| [ArgoCD](https://argo-cd.readthedocs.io/) | GitOps — sincroniza o cluster com o que está declarado em repositórios Git |
| [Minikube](https://minikube.sigs.k8s.io/) | Cluster Kubernetes local (driver `docker`) |

## Arquitetura

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

Todos os componentes se comunicam via DNS interno do Kubernetes; o acesso externo (navegador) é feito via `kubectl port-forward`.

## Começando

📖 Guia completo de instalação, do zero absoluto até o Backstage rodando com SSO, catálogo e ArgoCD integrados (com uma seção dedicada aos bugs reais encontrados no caminho e como resolvê-los) — material de curso, mantido fora deste repositório público por enquanto.

### Pré-requisitos rápidos

Docker (Docker Desktop), kubectl, Minikube, Node.js 22.16.0, Yarn 4.13 (via Corepack), gh CLI.

## Estrutura do repositório

```
.
├── docker/
│   └── Dockerfile              # Build multi-stage da imagem (Yarn Berry)
├── k8s/
│   ├── keycloak.yaml            # Manifesto do Keycloak
│   ├── postgres.yaml            # Manifesto do PostgreSQL
│   ├── setup-keycloak.sh        # Automação REST API do realm/client/usuários
│   └── app-config.production.yaml  # Overlay de produção (integrações reais)
├── packages/
│   ├── app/                     # Frontend do Backstage (New Frontend System)
│   └── backend/                  # Backend do Backstage (plugins, auth, integrações)
├── app-config.yaml              # Config base / desenvolvimento local
└── catalog-info.yaml            # Auto-registro deste repo no próprio catálogo
```

## Autenticação de teste

Após seguir o guia de instalação, login via Keycloak com:

- **Usuário:** `alice.admin`
- **Senha:** `password123`
