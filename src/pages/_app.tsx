import { ErrorBoundary } from 'next/dist/client/components/error-boundary';
import Head from 'next/head';
import Error from './error';
import { StoreProvider } from '@/hooks/use-store';

import '../i18n/client';
import '../styles/variables.css';
import '../styles/media.css';
import '../styles/fonts.css';
import '../styles/common.css';

function MyApp({ Component, pageProps }) {
  return (
    <ErrorBoundary
      errorComponent={({ error, reset }) => (
        <Error error={error} reset={reset} />
      )}
    >
      <StoreProvider>
        <>
          <Head>
            <link rel="shortcut icon" href="/favicon.ico" />
            <link
              rel="icon"
              type="image/png"
              sizes="32x32"
              href="/favicon-32x32.png"
            />
            {/* key allows page-level Head tags to override these defaults */}
            <meta
              name="image"
              property="og:image"
              content="https://assets.zilliz.com/meta_image_milvus_d6510e10e0.png"
              key="og-image"
            />
            <meta name="baidu-site-verification" content="codeva-bAvzh4ipX4" />
            <meta property="og:type" content="WebSite" key="og-type" />
            <meta
              name="keywords"
              content="milvus, vector database, milvus docs, milvus blogs"
            />
          </Head>
          <Component {...pageProps} />
        </>
      </StoreProvider>
    </ErrorBoundary>
  );
}

export default MyApp;
