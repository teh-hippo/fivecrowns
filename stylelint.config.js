export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // The app supports iOS before 15.4, which needs -webkit- masks, backdrop
    // filters, user-select and text-size-adjust. Autofix strips them silently.
    'property-no-vendor-prefix': null,
    // clip sits alongside clip-path in .visually-hidden for the same reason.
    'property-no-deprecated': null,
    // Source order here is deliberate: base rules first, then their modifiers.
    'no-descending-specificity': null,
    // Banner phase classes are generated from camelCase JS status phases.
    'selector-class-pattern': [
      '^[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$',
      { message: (selector) => `Expected class selector "${selector}" to be kebab-case` },
    ],
  },
};
