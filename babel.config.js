module.exports = {
  ignore: [
    /__mocks__/,
    /__tests__/
  ],
  plugins: [
  ],
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: process.versions.node
        }
      }
    ],
    '@babel/preset-typescript'
  ]
};
