// api/gamification/points/history.js
// API para obter histórico de pontos do usuário

const { query, getUserById } = require('../utils/database');
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
    
    // Obter parâmetros da query
    const userId = parseInt(req.query.userId);
    const limit = parseInt(req.query.limit) || 50; // Padrão: 50 registros
    const offset = parseInt(req.query.offset) || 0; // Padrão: começar do início
    const pointsType = req.query.pointsType; // Filtro opcional por tipo
    
    // Validar parâmetros obrigatórios
    if (!userId) {
      return res.status(400).json(createResponse(false, null, 'userId é obrigatório', 400));
    }
    
    // Validar limite
    if (limit > 100) {
      return res.status(400).json(createResponse(false, null, 'Limite máximo é 100 registros', 400));
    }
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode ver seu próprio histórico, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a ver histórico deste usuário', 403));
    }
    
    // Construir query base
    let queryText = `
      SELECT 
        id,
        points_earned,
        points_type,
        description,
        order_id,
        created_at
      FROM points_history 
      WHERE user_id = $1
    `;
    
    let queryParams = [userId];
    let paramIndex = 2;
    
    // Adicionar filtro por tipo se fornecido
    if (pointsType) {
      queryText += ` AND points_type = $${paramIndex}`;
      queryParams.push(pointsType);
      paramIndex++;
    }
    
    // Adicionar ordenação e paginação
    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);
    
    // Executar query principal
    const historyResult = await query(queryText, queryParams);
    
    // Query para contar total de registros
    let countQueryText = `
      SELECT COUNT(*) as total 
      FROM points_history 
      WHERE user_id = $1
    `;
    let countQueryParams = [userId];
    
    if (pointsType) {
      countQueryText += ` AND points_type = $2`;
      countQueryParams.push(pointsType);
    }
    
    const countResult = await query(countQueryText, countQueryParams);
    const totalRecords = parseInt(countResult.rows[0].total);
    
    // Query para estatísticas
    const statsResult = await query(`
      SELECT 
        SUM(points_earned) as total_points_earned,
        COUNT(*) as total_transactions,
        AVG(points_earned) as average_points_per_transaction,
        points_type,
        COUNT(*) as count_by_type
      FROM points_history 
      WHERE user_id = $1
      GROUP BY points_type
      ORDER BY count_by_type DESC
    `, [userId]);
    
    // Preparar dados do histórico
    const history = historyResult.rows.map(row => ({
      id: row.id,
      pointsEarned: row.points_earned,
      pointsType: row.points_type,
      description: row.description,
      orderId: row.order_id,
      earnedAt: row.created_at
    }));
    
    // Preparar estatísticas
    const stats = {
      totalPointsEarned: statsResult.rows.reduce((sum, row) => sum + parseInt(row.total_points_earned), 0),
      totalTransactions: totalRecords,
      averagePointsPerTransaction: statsResult.rows.length > 0 ? 
        Math.round(statsResult.rows.reduce((sum, row) => sum + parseFloat(row.average_points_per_transaction), 0) / statsResult.rows.length) : 0,
      pointsByType: statsResult.rows.map(row => ({
        type: row.points_type,
        totalPoints: parseInt(row.total_points_earned),
        transactionCount: parseInt(row.count_by_type)
      }))
    };
    
    // Preparar resposta
    const responseData = {
      userId,
      history,
      pagination: {
        limit,
        offset,
        totalRecords,
        hasMore: offset + limit < totalRecords,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(totalRecords / limit)
      },
      filters: {
        pointsType: pointsType || null
      },
      statistics: stats
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Histórico obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get points history');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

