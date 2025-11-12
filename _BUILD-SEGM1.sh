DIR=$(dirname "$BASH_SOURCE[0]")

export __CONFIG__=segm1

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. segm
cd segm
git add . && git commit --allow-empty -m auto && git push origin main
