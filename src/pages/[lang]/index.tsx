import SizingTool from '@/pages/tools/sizing';
import { getAllLanguageSlugs } from '@/utils/localization';

export default SizingTool;

export function getStaticPaths() {
  return {
    paths: getAllLanguageSlugs(),
    fallback: false,
  };
}

export function getStaticProps({ params }) {
  return {
    props: {
      locale: params.lang,
    },
  };
}
