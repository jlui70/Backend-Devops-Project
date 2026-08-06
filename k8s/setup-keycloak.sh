#!/bin/bash
set -e

echo "Obtendo token de administrador..."
TOKEN=$(curl -s -X POST http://localhost:8082/realms/master/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=keycloak-admin-1234" \
  -d "grant_type=password" | jq -r '.access_token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Erro ao obter o token! Verifique se o port-forward na porta 8082 está ativo."
  exit 1
fi

echo "Token obtido com sucesso!"

echo "Criando Realm 'backstage'..."
curl -s -X POST http://localhost:8082/admin/realms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"realm": "backstage","enabled": true,"displayName": "Backstage Realm"}'

echo "Criando OIDC Client 'backstage'..."
curl -s -X POST http://localhost:8082/admin/realms/backstage/clients \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "backstage",
    "enabled": true,
    "protocol": "openid-connect",
    "publicClient": false,
    "clientAuthenticatorType": "client-secret",
    "redirectUris": ["http://localhost:7007/*","http://localhost:3000/*"],
    "webOrigins": ["http://localhost:7007","http://localhost:3000"],
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": true,
    "serviceAccountsEnabled": true,
    "authorizationServicesEnabled": true
  }'

CLIENT_UUID=$(curl -s http://localhost:8082/admin/realms/backstage/clients \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.clientId=="backstage") | .id')

CLIENT_SECRET=$(curl -s http://localhost:8082/admin/realms/backstage/clients/$CLIENT_UUID/client-secret \
  -H "Authorization: Bearer $TOKEN" | jq -r '.value')

echo "Criando grupos..."
for group in "platform-admins" "developers" "viewers"; do
  curl -s -X POST http://localhost:8082/admin/realms/backstage/groups \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$group\"}"
done

echo "Criando usuário alice.admin..."
curl -s -X POST http://localhost:8082/admin/realms/backstage/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice.admin",
    "email": "alice.admin@techcorp.com",
    "firstName": "Alice",
    "lastName": "Admin",
    "enabled": true,
    "emailVerified": true,
    "credentials": [{"type": "password", "value": "password123", "temporary": false}]
  }'

USER_ID=$(curl -s http://localhost:8082/admin/realms/backstage/users?username=alice.admin \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

GROUP_ID=$(curl -s http://localhost:8082/admin/realms/backstage/groups \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.name=="platform-admins") | .id')

curl -s -X PUT http://localhost:8082/admin/realms/backstage/users/$USER_ID/groups/$GROUP_ID \
  -H "Authorization: Bearer $TOKEN"

echo "Configurando Group Mapper..."
curl -s -X POST http://localhost:8082/admin/realms/backstage/clients/$CLIENT_UUID/protocol-mappers/models \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "groups",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-group-membership-mapper",
    "config": {
      "full.path": "false",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "claim.name": "groups",
      "userinfo.token.claim": "true"
    }
  }'

SERVICE_ACCOUNT_USER=$(curl -s http://localhost:8082/admin/realms/backstage/clients/$CLIENT_UUID/service-account-user \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

REALM_MGMT_CLIENT=$(curl -s http://localhost:8082/admin/realms/backstage/clients \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.clientId=="realm-management") | .id')

VIEW_USERS_ROLE=$(curl -s http://localhost:8082/admin/realms/backstage/clients/$REALM_MGMT_CLIENT/roles \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.name=="view-users")')

curl -s -X POST http://localhost:8082/admin/realms/backstage/users/$SERVICE_ACCOUNT_USER/role-mappings/clients/$REALM_MGMT_CLIENT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "[$VIEW_USERS_ROLE]"

echo "--------------------------------------------------"
echo "CONFIGURAÇÃO CONCLUÍDA COM SUCESSO!"
echo "CLIENT SECRET DO BACKSTAGE: $CLIENT_SECRET"
echo "--------------------------------------------------"
