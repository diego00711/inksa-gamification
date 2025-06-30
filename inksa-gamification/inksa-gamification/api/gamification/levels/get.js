// api/gamification/levels/get.js
// API para obter nível atual do usuário

const { getUserPoints, getUserById, calculateLevel, getNextLevel, query } = require('../utils/database');
const { 
  authenticateUser, 
  createResponse, 
  handleError, 
  handleCors 
} = require('../utils/auth');

module.exports = async (req, res) => {
  try {
    // Lidar com CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) return res.status(corsResponse.statusCode).json(corsResponse);
    
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
    
    // Verificar autorização (usuário só pode ver seu próprio nível, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a ver nível deste usuário', 403));
    }
    
    // Obter pontos do usuário
    const userPoints = await getUserPoints(userId);
    
    // Obter informações do nível atual
    const currentLevel = await calculateLevel(userPoints.total_points);
    
    // Obter informações do próximo nível
    const nextLevel = await getNextLevel(currentLevel.level_number);
    
    // Obter informações do nível anterior
    const previousLevelResult = await query(`
      SELECT level_number, level_name, points_required, benefits 
      FROM levels 
      WHERE level_number < $1 
      ORDER BY level_number DESC 
      LIMIT 1
    `, [currentLevel.level_number]);
    
    const previousLevel = previousLevelResult.rows[0] || null;
    
    // Calcular progresso no nível atual
    const currentLevelStartPoints = currentLevel.points_required;
    const nextLevelPoints = nextLevel ? nextLevel.points_required : userPoints.total_points;
    const pointsInCurrentLevel = userPoints.total_points - currentLevelStartPoints;
    const pointsNeededForCurrentLevel = nextLevel ? nextLevelPoints - currentLevelStartPoints : 0;
    const progressPercentage = nextLevel ? 
      Math.round((pointsInCurrentLevel / pointsNeededForCurrentLevel) * 100) : 100;
    
    // Obter estatísticas de tempo no nível atual
    const levelStatsResult = await query(`
      SELECT 
        MIN(created_at) as level_achieved_at,
        COUNT(*) as points_earned_in_level
      FROM points_history 
      WHERE user_id = $1 
      AND created_at >= (
        SELECT COALESCE(
          (SELECT MAX(created_at) 
           FROM points_history ph2 
           WHERE ph2.user_id = $1 
           AND (SELECT SUM(points_earned) 
                FROM points_history ph3 
                WHERE ph3.user_id = $1 
                AND ph3.created_at <= ph2.created_at) >= $2),
          (SELECT MIN(created_at) FROM points_history WHERE user_id = $1)
        )
      )
    `, [userId, currentLevelStartPoints]);
    
    const levelStats = levelStatsResult.rows[0];
    
    // Preparar resposta
    const responseData = {
      userId,
      currentLevel: {
        number: currentLevel.level_number,
        name: currentLevel.level_name,
        pointsRequired: currentLevel.points_required,
        benefits: JSON.parse(currentLevel.benefits),
        achievedAt: levelStats.level_achieved_at,
        pointsEarnedInLevel: parseInt(levelStats.points_earned_in_level) || 0
      },
      previousLevel: previousLevel ? {
        number: previousLevel.level_number,
        name: previousLevel.level_name,
        pointsRequired: previousLevel.points_required,
        benefits: JSON.parse(previousLevel.benefits)
      } : null,
      nextLevel: nextLevel ? {
        number: nextLevel.level_number,
        name: nextLevel.level_name,
        pointsRequired: nextLevel.points_required,
        benefits: JSON.parse(nextLevel.benefits)
      } : null,
      progress: {
        totalPoints: userPoints.total_points,
        pointsInCurrentLevel: pointsInCurrentLevel,
        pointsNeededForNextLevel: nextLevel ? nextLevel.points_required - userPoints.total_points : 0,
        progressPercentage: progressPercentage,
        isMaxLevel: !nextLevel
      },
      levelBenefits: {
        current: JSON.parse(currentLevel.benefits),
        next: nextLevel ? JSON.parse(nextLevel.benefits) : null,
        improvements: nextLevel ? (() => {
          const current = JSON.parse(currentLevel.benefits);
          const next = JSON.parse(nextLevel.benefits);
          const improvements = {};
          
          for (const [key, value] of Object.entries(next)) {
            if (current[key] !== value) {
              improvements[key] = {
                current: current[key] || 0,
                next: value,
                improvement: typeof value === 'number' && typeof current[key] === 'number' ? 
                  value - (current[key] || 0) : null
              };
            }
          }
          
          return improvements;
        })() : null
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Nível obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get user level');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

