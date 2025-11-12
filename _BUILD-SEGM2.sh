DIR=$(dirname "$BASH_SOURCE[0]")

export __CONFIG__=segm2

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. segm-4
cd segm-4
git add . && git commit --allow-empty -m auto && git push origin main
