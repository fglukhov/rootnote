// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
const next = require("eslint-config-next");

module.exports = [
  { ignores: ["src/generated/**"] },
  ...next,
];