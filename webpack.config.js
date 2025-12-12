const path = require('path');

module.exports = {
  target: 'node',
  entry: './src/index.ts',
  mode: 'production',
  optimization: {
    minimize: false,
  },
  context: __dirname,
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    clean: true,
  },
  resolve: {
    modules: ['.', 'src', 'node_modules'],
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.scss$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.pug$/,
        use: ['apply-loader', 'pug-loader'],
      },
    ],
  },
  externals: [
    'fs',
    'os',
    'path',
    'crypto',
    'http',
    'https',
    'url',
    'net',
    'tls',
    'stream',
    'events',
    'util',
    'buffer',
    'querystring',
    'child_process',
    'electron',
    'ngx-toastr',
    'rxjs',
    'rxjs/operators',
    /^@angular\//,
    /^@ng-bootstrap\//,
    /^tabby-/,
    /^zone\.js/,
  ],
  stats: {
    errorDetails: true,
  },
};
