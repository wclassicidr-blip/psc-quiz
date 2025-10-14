// pages/index.js
export default function Home() { return null; }
export async function getServerSideProps() {
  return { redirect: { destination: '/index.html', permanent: false } };
}
