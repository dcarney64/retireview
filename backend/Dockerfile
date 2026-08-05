FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# argon2/bcrypt compile from source on Alpine (no musl prebuilds); the
# toolchain is removed in the same layer once node_modules is built.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm install --omit=dev \
    && apk del .build-deps
COPY src/ ./src/
EXPOSE 8006
CMD ["node", "src/index.js"]
