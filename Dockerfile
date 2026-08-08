FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM base AS build
RUN npm run build

FROM base AS api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:api"]

FROM base AS worker
ENV NODE_ENV=production
CMD ["npm", "run", "start:worker"]

FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
