// api/gamification/points/add.js
// API para adicionar pontos ao usuário

const { addPointsToUser, getUserById } = require('../utils/database');
const { 
  authenticateUser, 
  validateRequiredParams, 
  validateDataTypes,
  sanitizeInput,
  createResponse, 
  handleError, 
  handleCors 
} = require('../utils/auth');

module.exports = async (req, res) => {
  try {
    // Lidar com CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) return res.status(corsResponse.statusCode).end();
    
    // Verificar método HTTP
    if (req.method !== 'POST') {
      return res.status(405).json(createResponse(false, null, 'Método não permitido', 405));
    }
    
    // Autenticar usuário ou verificar API key
    const auth = authenticateUser(req);
    
    // Sanitizar entrada
    const body = sanitizeInput(req.body);
    
    // Validar parâmetros obrigatórios
    const requiredFields = ['userId', 'points', 'pointsType'];
    validateRequiredParams(body, requiredFields);
    
    // Validar tipos de dados
    validateDataTypes(body, {
      userId: 'integer',
      points: 'integer',
      pointsType: 'string',
      description: 'string',
      orderId: 'integer'
    });
    
    const { userId, points, pointsType, description, orderId } = body;
    
    // Verificar se os pontos são positivos
    if (points <= 0) {
      return res.status(400).json(createResponse(false, null, 'Pontos devem ser um valor positivo', 400));
    }
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode adicionar pontos para si mesmo, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a adicionar pontos para este usuário', 403));
    }
    
    // Adicionar pontos
    const result = await addPointsToUser(
      userId, 
      points, 
      pointsType, 
      description || `Pontos adicionados: ${pointsType}`,
      orderId
    );
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, {
      userId,
      pointsAdded: points,
      newTotal: result.newTotal,
      currentLevel: result.currentLevel,
      pointsToNextLevel: result.pointsToNextLevel,
      pointsType,
      description: description || `Pontos adicionados: ${pointsType}`
    }, 'Pontos adicionados com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'add points');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

