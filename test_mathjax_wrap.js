
const fs = require('fs');

// Mock a simple version of wrapWithMathJax logic
function wrapWithMathJax(html) {
  const mathJaxConfig = `
<script>
(function() {
  if (window.location.hostname.indexOf('blogger.com') !== -1) return;

  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
      displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    }
  };
})();
</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
`;
  return (mathJaxConfig.trim() + "\n" + html).trim();
}

const testHtml = "<h2>Test Formula</h2><p>$$L \\propto \\frac{1}{i^n}$$</p>";
const wrapped = wrapWithMathJax(testHtml);
console.log("--- WRAPPED HTML ---");
console.log(wrapped);
console.log("--- END ---");
