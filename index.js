require('dotenv').config();

const NewsAPI = require('newsapi');
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

newsapi.v2.topHeadlines({
  sources: 'techcrunch',
  language: 'en'
}).then(response => {
  console.log(response.articles);
});