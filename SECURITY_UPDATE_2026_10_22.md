# セキュリティ更新 2026-10-22

undiciを互換範囲で更新。npm audit 0件、68テスト成功。

Node.jsは24.22.1以上の24系を使用。.nvmrcとenginesで明記。Vercelの24.xは基盤側管理のため、設定だけで稼働中のパッチ番号まで検証したことにはならない。

ブランチ：security/node-october-2026。GitHubへの引き継ぎ用。当該ブランチのVercel自動デプロイは無効化。本番デプロイ・DB初期化は未実施。main統合と公開は別途指示後。

根拠：https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
