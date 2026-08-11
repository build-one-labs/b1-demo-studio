## start builder

yarn workspace @buildone/app-server-ts start:dev

## build bash api (experimental)

docker run --rm -v ${PWD}:/local --add-host=api:host-gateway openapitools/openapi-generator-cli:v6.6.0 generate -i http://api:3000/api-json -g bash -o /local/bash-client

## use bash client (experimental)

bash-client/client.sh --host http://localhost:3000 weatherInfo --header authorization:"bearer <token>"
