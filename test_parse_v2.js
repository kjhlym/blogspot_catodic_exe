
const robustJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.log('Standard JSON.parse failed, attempting robust parse...');
    
    // Protect existing escapes and backslashes in LaTeX
    // We tokenize the string to avoid mangling already valid escapes
    let tokenized = str;
    const tokens = [];
    
    // 1. Protect existing common escapes: \\, \", \n, \r, \t
    tokenized = tokenized.replace(/\\\\|\\"|\\n|\\r|\\t/g, (match) => {
      const id = `__TOKEN_${tokens.length}__`;
      tokens.push(match);
      return id;
    });

    // 2. Now handle single backslashes (often found in LaTeX from AI)
    // In JSON, backslashes must be escaped. AI often sends \frac instead of \\frac.
    // However, we must be careful not to escape the backslash of our tokens.
    tokenized = tokenized.replace(/\\(?!")/g, '\\\\');

    // 3. Restore tokens
    tokens.forEach((token, i) => {
      tokenized = tokenized.replace(`__TOKEN_${i}__`, token);
    });

    try {
      return JSON.parse(tokenized);
    } catch (e2) {
      console.error('Robust JSON parse failed:', e2.message);
      // Fallback: try to just fix the most common issue (unbalanced backslashes)
      const fixed = str.replace(/\\/g, '\\\\').replace(/\\\\"/g, '\\"');
      return JSON.parse(fixed);
    }
  }
};

const testStr = '{"content": "Calculate $$L \\propto \\frac{1}{i^n}$$ and more."}';
console.log('Original String:', testStr);
const parsed = robustJsonParse(testStr);
console.log('Parsed Content:', parsed.content);
