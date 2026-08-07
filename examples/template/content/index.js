const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: '${{ values.name }}' });
});

app.listen(port, () => {
  console.log('${{ values.name }} listening on port ' + port);
});
