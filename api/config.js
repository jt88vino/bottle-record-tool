const { loadConfig, saveConfig } = require('../lib/config-store');

module.exports = async (request, response) => {
  if (request.method === 'GET') {
    const config = await loadConfig();
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(config);
  }
  if (request.method !== 'PUT') {
    response.setHeader('Allow', 'GET, PUT');
    return response.status(405).json({ error: 'GETまたはPUTで送信してください。' });
  }
  if (!process.env.ADMIN_SECRET || request.headers['x-admin-key'] !== process.env.ADMIN_SECRET) {
    return response.status(401).json({ error: '編集用パスワードが正しくありません。' });
  }
  try {
    const config = await saveConfig(request.body);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(config);
  } catch (error) {
    return response.status(400).json({ error: error.message || '設定を保存できませんでした。' });
  }
};
