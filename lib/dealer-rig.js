// Who gets a helping hand when they deal, and which way. The rules layer knows
// nothing about these names: it is handed a resolver and asked to honour it.
// Each rule carries its own default, so a stored setting only ever records a
// deliberate change rather than standing in for one that was never made.
const DEALER_RIG_RULES = Object.freeze([
  Object.freeze({
    key: 'dadLowCards',
    id: 'dad-low-cards',
    dealer: 'dad',
    prefer: 'low',
    default: true,
    label: 'Dad gets the lowest remaining card count while dealing',
  }),
  Object.freeze({
    key: 'mumHighCards',
    id: 'mum-high-cards',
    dealer: 'mum',
    prefer: 'high',
    default: true,
    label: 'Mum gets the highest remaining card count while dealing',
  }),
]);

function normaliseDealerRigSettings(value) {
  const stored = value && typeof value === 'object' ? value : {};
  const settings = {};
  DEALER_RIG_RULES.forEach((rule) => {
    settings[rule.key] = rule.key in stored ? !!stored[rule.key] : rule.default;
  });
  return settings;
}

function defaultDealerRigSettings() {
  return normaliseDealerRigSettings(null);
}

// Returns 'low', 'high' or null for a dealer name, honouring only enabled rules.
function dealerPreferenceResolver(settings) {
  const enabled = normaliseDealerRigSettings(settings);
  const byDealer = new Map();
  DEALER_RIG_RULES.forEach((rule) => {
    if (enabled[rule.key]) byDealer.set(rule.dealer, rule.prefer);
  });
  if (!byDealer.size) return () => null;
  return (name) => {
    const key = String(name || '')
      .trim()
      .toLowerCase();
    return byDealer.get(key) || null;
  };
}

const DEALER_RIG_KEY = 'fivecrowns:dealerRig';

function loadDealerRigSettings() {
  try {
    return normaliseDealerRigSettings(JSON.parse(localStorage.getItem(DEALER_RIG_KEY)));
  } catch (_) {
    return defaultDealerRigSettings();
  }
}

function saveDealerRigSettings(settings) {
  const value = normaliseDealerRigSettings(settings);
  try {
    localStorage.setItem(DEALER_RIG_KEY, JSON.stringify(value));
  } catch (_) {
    /* settings stay in memory for this session */
  }
  return value;
}

// Convenience for callers that only need the resolver the rules layer wants.
function loadDealerPreference() {
  return dealerPreferenceResolver(loadDealerRigSettings());
}

export {
  DEALER_RIG_RULES,
  normaliseDealerRigSettings,
  defaultDealerRigSettings,
  dealerPreferenceResolver,
  loadDealerRigSettings,
  saveDealerRigSettings,
  loadDealerPreference,
};
