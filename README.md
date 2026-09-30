# Three Words

Uma PWA mobile-first para transformar vocabulário novo em vocabulário ativo: três palavras por dia, sem pressão.

## O que está incluído

- seleção diária inteligente de até três palavras;
- repetição espaçada com intervalos de 3, 7, 14, 30, 60 e 120 dias;
- aprendizagem implícita a partir de significados consultados, recordação sem ajuda e utilização real;
- adição rápida de várias palavras e expressões;
- biblioteca pesquisável com filtros, edição, eliminação e histórico;
- persistência local em IndexedDB e funcionamento offline através de service worker;
- modo claro/escuro, manifest PWA e ícones para Android e iOS;
- suporte no service worker para receber push e abrir diretamente o ecrã Today;
- ações WebMCP para consultar as palavras do dia e adicionar vocabulário.

## Executar localmente

Uma PWA precisa de ser servida por `https://` ou por `localhost`; abrir diretamente o ficheiro `index.html` não ativa o modo offline nem a instalação. Publique esta pasta num serviço de alojamento estático ou sirva-a localmente e abra o endereço apresentado no navegador.

## Notificações em segundo plano

O service worker já trata os eventos `push` e `notificationclick`. A entrega diária com a aplicação fechada requer ligar uma subscrição Web Push a um serviço backend/serverless que guarde as subscrições e envie a mensagem no horário escolhido. A interface identifica esta dependência para não prometer notificações que só funcionem com o browser aberto.
