// api/gamification/points/get.js
// API para obter pontos do usuário

const { getUserPoints, getUserById, calculateLevel, getNextLevel } = require('../utils/database');
const { 
  authenticateUser, 
  validateRequiredParams,
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
    if (req.method !== 'GET') {
      return res.status(405).json(createResponse(false, null, 'Método não permitido', 405));
    }
    
    // Autenticar usuário ou verificar API key
    const auth = authenticateUser(req);
    
    // Obter userId dos parâmetros da query
    const userId = parseInt(req.query.userId);
    
    // Validar parâmetros obrigatórios
    if (!userId) {
      return res.status(400).json(createResponse(false, null, 'userId é obrigatório', 400));
    }
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode ver seus próprios pontos, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a ver pontos deste usuário', 403));
    }
    
    // Obter pontos do usuário
    const userPoints = await getUserPoints(userId);
    
    // Obter informações do nível atual
    const currentLevel = await calculateLevel(userPoints.total_points);
    
    // Obter informações do próximo nível
    const nextLevel = await getNextLevel(currentLevel.level_number);
    
    // Calcular pontos para o próximo nível
    const pointsToNextLevel = nextLevel ? 
      nextLevel.points_required - userPoints.total_points : 0;
    
    // Preparar resposta
    const responseData = {
      userId: userPoints.user_id,
      totalPoints: userPoints.total_points,
      currentLevel: {
        number: currentLevel.level_number,
        name: currentLevel.level_name,
        pointsRequired: currentLevel.points_required,
        benefits: JSON.parse(currentLevel.benefits)
      },
      nextLevel: nextLevel ? {
        number: nextLevel.level_number,
        name: nextLevel.level_name,
        pointsRequired: nextLevel.points_required,
        benefits: JSON.parse(nextLevel.benefits)
      } : null,
      pointsToNextLevel: pointsToNextLevel,
      progress: {
        currentLevelProgress: userPoints.total_points - currentLevel.points_required,
        nextLevelTarget: nextLevel ? nextLevel.points_required - currentLevel.points_required : 0,
        progressPercentage: nextLevel ? 
          Math.round(((userPoints.total_points - currentLevel.points_required) / 
          (nextLevel.points_required - currentLevel.points_required)) * 100) : 100
      },
      lastUpdated: userPoints.updated_at
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Pontos obtidos com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get points');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

