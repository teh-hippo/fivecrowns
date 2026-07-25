// Fisher-Yates. The random source is injectable so callers can make shuffles
// deterministic under test.
function shuffle(values, random = Math.random) {
  const result = Array.isArray(values) ? values.slice() : [];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export { shuffle };
