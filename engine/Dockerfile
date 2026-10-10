# ШАУРМА-движок: Python + Node.js (Node исполняет JS-варианты для получения эталонного ответа)
FROM python:3.12-slim
# Зеркало Debian (если deb.debian.org недоступен из сети сервера), например DEBIAN_MIRROR=http://mirror.yandex.ru
ARG DEBIAN_MIRROR=
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s|http://deb.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi  && apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine/app ./app
COPY engine/validation ./validation
COPY engine/training ./training
# «Маринад»: дообученные на живых данных модели живут в томе и переживают пересборку образа
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 MODELS_DIR=/data/models
RUN mkdir -p /data/models
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
