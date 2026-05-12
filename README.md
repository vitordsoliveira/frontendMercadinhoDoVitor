## Como rodar

1. Rode `npm run dev` na pasta frontend

## Fluxo da API

- Cadastro do seller
- Ativacao da conta com codigo recebido no WhatsApp
- Login com e-mail, senha e token do seller
- Cadastro, edicao e inativacao de produtos
- Registro de vendas

## Observacao importante

Depois que a conta e ativada, a API devolve um `token` do seller. Esse token deve ser guardado porque os proximos logins podem exigir esse valor junto com e-mail e senha.
