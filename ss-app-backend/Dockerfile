# Stage 1: Build
FROM gradle:8.5-jdk17 AS build
WORKDIR /app
COPY . .
RUN gradle buildFatJar --no-daemon

# Stage 2: Run
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/build/libs/ss-app-backend.jar app.jar

EXPOSE 8080

CMD ["java", "-jar", "app.jar"]
