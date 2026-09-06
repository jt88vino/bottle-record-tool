module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'POSTで送信してください。' });
  }
  const password = request.body?.password;
  if (typeof password !== 'string' || !process.env.ADMIN_SECRET || password !== process.env.ADMIN_SECRET) {
    return response.status(401).json({ error: '編集用パスワードが正しくありません。' });
  }
  return response.status(200).json({ ok: true });
};
