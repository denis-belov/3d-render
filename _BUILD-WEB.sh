DIR=$(dirname "$BASH_SOURCE[0]")

export __WEB__=true
export __CONFIG__=web
export __API_PACS__=https://tasty.pacs.fishbirds.ru
export __API_MARKUP__=https://markup.fishbirds.ru

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. segm-web
cd segm-web
git add . && git commit --allow-empty -m auto && git push origin main
