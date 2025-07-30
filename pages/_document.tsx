import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en" className="bg-white text-black dark:bg-black dark:text-white">
      <Head />
      <body className="min-h-screen bg-white text-black dark:bg-black dark:text-white transition-colors duration-300">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
