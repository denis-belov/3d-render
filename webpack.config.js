const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
// const CopyPlugin = require('copy-webpack-plugin');
const CleanTerminalPlugin = require('clean-terminal-webpack-plugin');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

// const vtk_rules = require('@kitware/vtk.js/Utilities/config/dependency.js').webpack.core.rules;

// vtk_rules[2].use =
// {
// 	loader: 'worker-loader',
// 	options: { inline: 'fallback' },
// };



module.exports = (env) =>
	({
		entry: './src/index.js',

		target: 'web',

		resolve:
		{
			extensions: [ '.js', '.jsx', '.scss' ],
		},

		output:
		{
			path: path.join(__dirname, 'build'),
		},

		module:
		{
			rules:
			[
				{
					test: /\.worker\.js$/,
					include: /src/,

					use: 'worker-loader',
				},

				{
					test: /\.(js|jsx)$/,
					// exclude: /node_modules/,

					use:

						// env === 'development' ?

							[
								{
									loader: 'babel-loader',

									// workaround for correct transpiling glkit when linking from local directory
									options: JSON.parse(fs.readFileSync('.babelrc')),
								},

								'@open-wc/webpack-import-meta-loader',

								{
									loader: 'conditional-compile-loader',

									// options: process.env,
									options:
									{
										WASM: Boolean(process.env.__WASM__),
										'NON-WASM': !Boolean(process.env.__WASM__),
									},
								}
							]
				},

				{
					test: /\.(css|scss)$/,

					use:
					[
						MiniCssExtractPlugin.loader,
						// to insert css into html
						// 'style-loader',
						'css-loader',
						'sass-loader',
					],
				},

				{
					test: /\.pug$/,

					use:
					[
						'html-loader',
						'pug-html-loader',
					],
				},

				// {
				// 	test: /\.html$/,
				// 	use: { loader: 'html-loader', options: { minimize: true } },
				// },

				{
					test: /\.(svg|png|jpg|jpeg)$/,
					use: 'base64-inline-loader',
				},

				// process.env.DIR_RENDERITY ?

				// 	{
				// 		test: /\.cpp.json$/,

				// 		use:
				// 		{
				// 			loader: `${ process.env.DIR_RENDERITY }/cpp-webpack-loader`,

				// 			// options:
				// 			// 	JSON.parse
				// 			// 	(fs.readFileSync(`${ process.env.DIR_RENDERITY }/genmake.config.json`)),
				// 		},

				// 		// Required prop to prevent webpack from importing sources as json.
				// 		type: 'javascript/auto',
				// 	} :

				// 	{},

				// {
				// 	test: /\.wasm$/,
				// 	use: 'arraybuffer-loader',
				// 	type: 'javascript/auto',
				// },

				// {
				// 	test: /thread.js|thread2.js$/,
				// 	use: 'raw-loader',
				// 	// type: 'asset/source',
				// },

				// ...vtk_rules,
			],
		},

		devtool: env === 'development' ? 'source-map' : false,

		plugins:
		[
			...(
				env === 'production' ?

					[
						new UglifyJsPlugin
						({
							test: /\.(js|jsx)$/,
							exclude: /node_modules/,

							uglifyOptions:
							{
								compress: {},
								mangle: true,
							},
						})
					] :

					[]
			),

			new CleanWebpackPlugin(),

			new MiniCssExtractPlugin({ filename: 'index.css' }),

			new OptimizeCSSAssetsPlugin({}),

			new HtmlWebpackPlugin
			({
				filename: path.join(__dirname, 'build/index.html'),
				template: path.join(__dirname, 'src/index.pug'),
				inject: 'body',

				minify:
				{
					removeAttributeQuotes: true,
				},
			}),

			// new CopyPlugin
			// ({
			// 	patterns:
			// 	[
			// 		// { from: 'src/test', to: 'test' },
			// 	],
			// }),

			new CleanTerminalPlugin({ beforeCompile: true }),

			new webpack.DefinePlugin
			({
				LOG: 'console.log',
				log: 'console.log',

				LOGC: 'console.clear() || console.log',
				logc: 'console.clear() || console.log',

				'process.env': JSON.stringify(process.env),
			}),
		],

		devServer:
		{
			compress: true,
			historyApiFallback: true,
			host: 'localhost',
			port: 8080,

			headers:
			{
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
			},
		},
	});
