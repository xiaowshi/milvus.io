const SIZING_ROUTE_RE =
  /^\/(?:(?:zh-hant|zh|ja|ko|fr|de|es|it|pt|ru|id|ar)(?:\/tools\/sizing(?:-v250)?)?|tools\/sizing(?:-v250)?)?$/;

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://milvus.io',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        host: 'https://milvus.io',
        sitemap: 'https://milvus.io/sitemap.xml',
      },
    ],
  },
  transform: async (config, path) => {
    if (!SIZING_ROUTE_RE.test(path)) return null;

    return {
      loc: path,
      changefreq: config.changefreq,
      priority: path.endsWith('sizing-v250') ? 0.7 : 0.8,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
      alternateRefs: [],
    };
  },
};
