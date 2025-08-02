

# PDFCHAT

PDFCHAT is an AI chat application that lets you upload your own documents (PDF, TXT, DOC, DOCX) and interact with them using advanced language models. No data is stored—everything is cleared as soon as you leave or refresh the site.

---

## Getting Started


1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/yourusername/pdfchat.git
   cd pdfchat
   pnpm install # or npm install or yarn install
   ```
2. **Start the development server:**
   ```bash
   pnpm dev # or npm run dev or yarn dev
   ```
3. **Open your browser:**
   - Go to [http://localhost:3000](http://localhost:3000)

---

## Usage


1. Upload PDF, TXT, DOC, or DOCX files using the sidebar.
2. Ask questions in the chat bar—AI will use your documents to answer if available.
3. All files and chat data are deleted when you leave or refresh the page.

---

## Deployment


### Production Deployment

1. Build and start the app:
   ```bash
   pnpm build && pnpm start
   # or
   npm run build && npm run start
   # or
   yarn build && yarn start
   ```
2. Set any required environment variables in `.env.local`.

---

## Security & Privacy


- All files and chat data are deleted on page unload.
- Only PDF, TXT, DOC, and DOCX files are accepted.
- No user accounts or tracking by default.


---




## Contributing

We welcome contributions from the community! If you have suggestions, bug reports, or would like to add features, please open an issue or submit a pull request. For major changes, consider discussing them in an issue first to ensure alignment with the project's direction.

---


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Disclaimer


We do not store or save your files or data. All uploaded documents and chat history are cleared as soon as you leave or refresh this site. Your privacy and security are our priority.