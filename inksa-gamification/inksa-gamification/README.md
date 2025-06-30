# Inksa Gamification API

Sistema de gamificação para o Inksa Delivery com APIs para pontos, níveis, distintivos, desafios e rankings.

## 🚀 Funcionalidades

### 📊 **Pontos**
- `POST /api/gamification/points/add` - Adicionar pontos ao usuário
- `GET /api/gamification/points/get` - Obter pontos do usuário
- `GET /api/gamification/points/history` - Histórico de pontos

### 🏆 **Níveis**
- `GET /api/gamification/levels/get` - Nível atual do usuário
- `GET /api/gamification/levels/list` - Listar todos os níveis

### 🏅 **Distintivos**
- `GET /api/gamification/badges/user` - Distintivos do usuário
- `GET /api/gamification/badges/available` - Distintivos disponíveis
- `POST /api/gamification/badges/award` - Conceder distintivo

### 🎯 **Desafios**
- `GET /api/gamification/challenges/active` - Desafios ativos
- `GET /api/gamification/challenges/progress` - Progresso do usuário
- `POST /api/gamification/challenges/complete` - Completar desafio

### 🏅 **Rankings**
- `GET /api/gamification/rankings/weekly` - Ranking semanal
- `GET /api/gamification/rankings/monthly` - Ranking mensal
- `GET /api/gamification/rankings/all-time` - Ranking geral

## 🔧 Configuração

### Variáveis de Ambiente

```env
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=your-jwt-secret-key
API_SECRET_KEY=your-internal-api-key
NODE_ENV=production
```

### Autenticação

**Para usuários finais:**
```
Authorization: Bearer <jwt-token>
```

**Para chamadas internas:**
```
X-API-Key: <api-secret-key>
```

## 📋 Estrutura do Banco de Dados

- `users` - Usuários do sistema
- `user_points` - Pontos dos usuários
- `points_history` - Histórico de pontos
- `levels` - Níveis do sistema
- `badges` - Distintivos disponíveis
- `user_badges` - Distintivos conquistados
- `challenges` - Desafios do sistema
- `user_challenge_progress` - Progresso nos desafios
- `rankings` - Rankings históricos

## 🚀 Deploy

1. Configure as variáveis de ambiente no Vercel
2. Conecte o repositório ao Vercel
3. Deploy automático será realizado

## 📖 Exemplos de Uso

### Adicionar Pontos
```javascript
const response = await fetch('/api/gamification/points/add', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token>'
  },
  body: JSON.stringify({
    userId: 1,
    points: 50,
    pointsType: 'order',
    description: 'Pedido realizado'
  })
});
```

### Obter Pontos do Usuário
```javascript
const response = await fetch('/api/gamification/points/get?userId=1', {
  headers: {
    'Authorization': 'Bearer <token>'
  }
});
```

## 🔒 Segurança

- Todas as APIs requerem autenticação
- Usuários só podem acessar seus próprios dados
- Chamadas internas usam API Key separada
- Validação de entrada em todas as APIs
- Sanitização de dados de entrada

## 📊 Monitoramento

- Logs detalhados de todas as operações
- Tratamento de erros padronizado
- Métricas de performance disponíveis no Vercel

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

