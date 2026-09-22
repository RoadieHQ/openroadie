# Build stage: bundle the server into a single file so the image needs no
# yarn workspace resolution.
FROM node:24-alpine AS build
WORKDIR /src
COPY . .
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock \
  && npx --yes esbuild@0.28.1 src/docker-entry.ts --bundle --platform=node --target=node24 --outfile=dist/server.cjs

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=7050
COPY --from=build /src/dist/server.cjs /app/server.cjs
EXPOSE 7050
USER node
CMD ["node", "/app/server.cjs"]
