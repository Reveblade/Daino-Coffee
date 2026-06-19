# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

# Vite bakes these into the static bundle at build time (set for your API / WS hosts).
ARG VITE_API_BASE_URL=http://localhost:3000/v1
ARG VITE_WS_URL=
ARG VITE_GOOGLE_MAPS_API_KEY=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM nginx:1.27-alpine
ENV PORT=8080
# Avoid envsubst/templates: base image may ship templates that overwrite conf.d at startup.
RUN rm -rf /etc/nginx/templates && mkdir -p /etc/nginx/templates
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
