const { get, put } = require('@vercel/blob');

const CONFIG_PATHNAME = 'bottling-record/config.json';

const wineNames = {
  'vol.1-1': 'シャトー モンテレーナ ナパ・ヴァレー シャルドネ',
  'vol.1-2': 'グレイワッキ ワイルドソーヴィニヨン',
  'vol.1-3': 'コノスル オシオ ピノ・ノワール',
  'vol.1-4': 'エラスリス ドン・マキシミアーノ ファウンダーズ・リザーヴ',
  'vol.2-1': 'ドメーヌ・ウィリアム・フェーブル シャブリ プルミエ・クリュ フルショーム',
  'vol.2-2': 'フリードリッヒ・ベッカー シュタインヴィンガート ピノ・ノワール',
  'vol.2-3': 'ラ・スピネッタ ランゲ・ネッビオーロ',
  'vol.2-4': 'シャトー・リューセック カルム・ド・リューセック',
  'vol.3-1': 'ドメーヌ・ツィント・フンブレヒト ロッシュ・カルケール ゲヴュルツトラミネール',
  'vol.3-2': 'ドメーヌ・ピエール・ガイヤール コンドリュー',
  'vol.3-3': 'オー・ボン・クリマ ピノ・ノワール サンタ・バーバラ・カウンティ',
  'vol.3-4': 'スリー オールド・ヴァインズ ジンファンデル コントラ・コスタ・カウンティ',
  'vol.4-1': 'ドメーヌ・マルセル・ダイス リースリング',
  'vol.4-2': 'ジェラール・ベルトラン シガリュス・ブラン',
  'vol.4-3': 'アミスフィールド ピノ・ノワール',
  'vol.4-4': 'ダックホーン・ヴィンヤーズ メルロー',
  'vol.5-1': 'アンリ・ブルジョワ レ・バロンヌ・ブラン',
  'vol.5-2': 'マリヌー オールド・ヴァインズ ホワイト スワートランド',
  'vol.5-3': 'メゾン ジョゼフ・ドルーアン コート・ド・ボーヌ ルージュ',
  'vol.5-4': 'ペンフォールズ ビン28 シラーズ',
  'vol.6-1': 'ジャン・ポール・エ・ブノワ・ドロワン シャブリ',
  'vol.6-2': 'アタラクシア シャルドネ',
  'vol.6-3': 'クネ インペリアル レゼルバ',
  'vol.6-4': 'クネ インペリアル グラン・レゼルバ',
  'vol.7-1': 'シャトー・ラグランジュ',
  'vol.7-2': 'シャトー・シマール',
  'vol.7-3': 'シャトー・カロン・セギュール マルキ・ド・カロン・セギュール',
  'vol.7-4': 'シャトー・ラグランジュ レ・ザルム・ド・ラグランジュ',
  'vol.8-1': 'ヨハン・ヨゼフ・プリュム ヴェーレナー・ゾンネンウーア リースリング カビネット',
  'vol.8-2': 'クヴェヴリ・ワイン・セラー ルカツィテリ クヴェヴリ',
  'vol.8-3': 'エスタンドン アンソランス',
  'vol.8-4': 'ウォルファー・エステイト カヤ カベルネ・フラン',
  'vol.9-1': 'バルミニョール アルバリーニョ',
  'vol.9-2': 'アルバロ・パラシオス レス・テラッセス',
  'vol.9-3': 'ハーシュ ヴィンヤーズ ピノ・ノワール サン・アンドレアス フォルト',
  'vol.9-4': 'シルヴァー・オーク アレキサンダー・ヴァレー カベルネ・ソーヴィニヨン',
  'vol.10-1': 'メゾン・ジョゼフ・ドルーアン サン・ヴェラン',
  'vol.10-2': 'メゾン ジョゼフ・ドルーアン ムルソー',
  'vol.10-3': 'ジュヴレ・シャンベルタン ブシャール・ペール・エ・フィス',
  'vol.10-4': 'ブシャール・ペール・エ・フィス シャンボール・ミュジニー',
  'vol.11-1': '仁木ヒルズワイナリー はつゆき',
  'vol.11-2': 'プラーガー グリューナー ヴェルトリーナー・ヒンター・デル・ブルグ フェーダーシュピール',
  'vol.11-3': 'トンマージ アマローネ・デッラ・ヴァルポリチェッラ クラッシコ',
  'vol.11-4': 'マデイラ セルシアル 5年',
  'vol.12-1': 'クラウディー ベイ ソーヴィニヨン ブラン',
  'vol.12-2': 'アシルティコ バイ イエア',
  'vol.12-3': 'シルバー ハイツ ザ・サミット',
  'vol.12-4': 'ルーチェ',
};

// Current Japanese importers are intentionally stored beside the product master so
// editors can revise them when a supplier or vintage changes.
const importerNames = {
  'vol.1-1': '布袋ワインズ株式会社', 'vol.1-2': 'ヴィレッジ・セラーズ株式会社', 'vol.1-3': '株式会社スマイル', 'vol.1-4': '株式会社JALUX',
  'vol.2-1': '株式会社ファインズ', 'vol.2-2': 'ヘレンベルガー・ホーフ株式会社', 'vol.2-3': 'ヴィレッジ・セラーズ株式会社', 'vol.2-4': '株式会社ファインズ',
  'vol.3-1': '日本リカー株式会社', 'vol.3-2': '株式会社ラック・コーポレーション', 'vol.3-3': '株式会社JALUX', 'vol.3-4': '布袋ワインズ株式会社',
  'vol.4-1': 'ヌーヴェル・セレクション', 'vol.4-2': 'ピーロート・ジャパン株式会社', 'vol.4-3': 'GRN株式会社', 'vol.4-4': '株式会社中川ワイン',
  'vol.5-1': '株式会社JALUX', 'vol.5-2': '株式会社モトックス', 'vol.5-3': '三国ワイン株式会社', 'vol.5-4': 'トレジャリー・ワイン・エステーツ・ジャパン株式会社',
  'vol.6-1': '株式会社稲葉', 'vol.6-2': '株式会社マスダ', 'vol.6-3': '三国ワイン株式会社', 'vol.6-4': '三国ワイン株式会社',
  'vol.7-1': 'サントリー株式会社', 'vol.7-2': '株式会社アストル', 'vol.7-3': '株式会社ベルーナ', 'vol.7-4': 'サントリー株式会社',
  'vol.8-1': 'ヘレンベルガー・ホーフ株式会社', 'vol.8-2': '株式会社オーバーシーズ', 'vol.8-3': '国分グループ本社株式会社', 'vol.8-4': 'ヴィレッジ・セラーズ株式会社',
  'vol.9-1': 'ワイン・イン・スタイル株式会社', 'vol.9-2': '株式会社ファインズ', 'vol.9-3': '木下インターナショナル株式会社', 'vol.9-4': '株式会社中川ワイン',
  'vol.10-1': '三国ワイン株式会社', 'vol.10-2': '三国ワイン株式会社', 'vol.10-3': '株式会社ファインズ', 'vol.10-4': '株式会社ファインズ',
  'vol.11-1': '仁木ヒルズヴィレッジ株式会社', 'vol.11-2': 'ヘレンベルガー・ホーフ株式会社', 'vol.11-3': '日本リカー株式会社', 'vol.11-4': '木下インターナショナル株式会社',
  'vol.12-1': 'MHD モエ ヘネシー ディアジオ株式会社', 'vol.12-2': 'ヴィレッジ・セラーズ株式会社', 'vol.12-3': '株式会社オーケーエージェンシー', 'vol.12-4': '日本リカー株式会社',
};

const defaultRecorderNames = ['田中', '鈴木', '長谷川', '喜多', '池亀', '村尾', '戸部', '出村'];

const defaultConfig = {
  title: '瓶詰め記録',
  smallBottleFactor: 7.5,
  recorderNames: defaultRecorderNames,
  groups: Array.from({ length: 12 }, (_, groupIndex) => {
    const volume = groupIndex + 1;
    return {
      id: `vol-${volume}`,
      label: `vol.${volume}`,
      rows: Array.from({ length: 4 }, (_, rowIndex) => ({
        id: `vol.${volume}-${rowIndex + 1}`,
        label: `vol.${volume}-${rowIndex + 1}`,
        wineName: wineNames[`vol.${volume}-${rowIndex + 1}`],
        importerName: importerNames[`vol.${volume}-${rowIndex + 1}`],
      })),
    };
  }),
};

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(defaultConfig));
}

function normalizeConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('設定内容が正しくありません。');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const factor = Number(input.smallBottleFactor);
  const recorderNames = Array.isArray(input.recorderNames) ? input.recorderNames : defaultRecorderNames;
  const groups = Array.isArray(input.groups) ? input.groups : [];
  if (!title || title.length > 60) throw new Error('タイトルは1〜60文字で入力してください。');
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) throw new Error('小瓶換算は0より大きく、1,000以下で入力してください。');
  if (!recorderNames.length || recorderNames.length > 100) throw new Error('記入者名は1〜100名にしてください。');
  const normalizedRecorderNames = recorderNames.map((name) => typeof name === 'string' ? name.trim() : '').filter(Boolean);
  if (normalizedRecorderNames.length !== recorderNames.length || normalizedRecorderNames.some((name) => name.length > 60) || new Set(normalizedRecorderNames).size !== normalizedRecorderNames.length) throw new Error('記入者名は重複なく1〜60文字で入力してください。');
  if (!groups.length || groups.length > 60) throw new Error('Vol.グループは1〜60件にしてください。');

  const ids = new Set();
  const normalizedGroups = groups.map((group, index) => {
    const label = typeof group.label === 'string' ? group.label.trim() : '';
    const rows = Array.isArray(group.rows) ? group.rows : [];
    if (!label || label.length > 60) throw new Error(`${index + 1}番目のVol.名が正しくありません。`);
    if (!rows.length || rows.length > 40) throw new Error(`${label} の項目数は1〜40件にしてください。`);
    return {
      id: `group-${index + 1}`,
      label,
      rows: rows.map((row, rowIndex) => {
        const rowLabel = typeof row.label === 'string' ? row.label.trim() : '';
        if (!rowLabel || rowLabel.length > 60) throw new Error(`${label} の${rowIndex + 1}番目の項目名が正しくありません。`);
        const id = `${index + 1}:${rowIndex + 1}:${rowLabel}`;
        if (ids.has(id)) throw new Error('同じ入力項目が重複しています。');
        ids.add(id);
        const wineName = typeof row.wineName === 'string' ? row.wineName.trim() : (wineNames[rowLabel] || '');
        const importerName = typeof row.importerName === 'string' ? row.importerName.trim() : (importerNames[rowLabel] || '');
        if (wineName.length > 180) throw new Error(`${rowLabel} のワイン名は180文字以内で入力してください。`);
        if (importerName.length > 120) throw new Error(`${rowLabel} のインポーター名は120文字以内で入力してください。`);
        return { id, label: rowLabel, wineName, importerName };
      }),
    };
  });
  return { title, smallBottleFactor: factor, recorderNames: normalizedRecorderNames, groups: normalizedGroups };
}

async function loadConfig() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return cloneDefaultConfig();
  try {
    const result = await get(CONFIG_PATHNAME, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return cloneDefaultConfig();
    return normalizeConfig(JSON.parse(await new Response(result.stream).text()));
  } catch (error) {
    console.error('Could not load bottling config:', error.message);
    return cloneDefaultConfig();
  }
}

async function saveConfig(config) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('設定ストレージが未接続です。管理者に連絡してください。');
  const normalized = normalizeConfig(config);
  await put(CONFIG_PATHNAME, JSON.stringify(normalized), {
    access: 'private',
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json',
  });
  return normalized;
}

module.exports = { loadConfig, normalizeConfig, saveConfig };
