// Clear Node.js require cache
console.log("Clearing Node.js require cache...");

Object.keys(require.cache).forEach(function(key) {
  delete require.cache[key];
});

console.log("Cache cleared!");