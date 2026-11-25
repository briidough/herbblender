FROM node:22-alpine
WORKDIR /app
# Both files, and `npm ci` rather than `npm install`: ci installs exactly the tree in the
# lockfile and fails if the two disagree. With package.json alone, `pg` was free to
# resolve to whatever ^8.23.1 meant on build day, so the image did not match what was
# tested locally.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
