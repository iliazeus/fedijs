FROM node:20.5.0-alpine

WORKDIR /app

COPY ./package*.json ./
RUN npm ci
COPY ./* ./

ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
