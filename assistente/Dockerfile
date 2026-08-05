FROM python:3.12-slim

# docker-cli permite a ferramenta listar_conteineres consultar os apps do CasaOS
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ /app/
COPY autorizar_google.py /autorizar_google.py

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app
CMD ["python", "main.py"]
