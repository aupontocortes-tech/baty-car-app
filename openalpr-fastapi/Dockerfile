FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt /app/
RUN apt-get update && apt-get install -y \
    libopencv-dev \
    wget \
    unzip \
    libleptonica-dev \
    libtesseract-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get clean

RUN wget https://github.com/openalpr/openalpr/releases/download/v2.3.0/openalpr-2.3.0-ubuntu-20.04.tar.gz -O /tmp/openalpr.tar.gz && \
    tar -xzf /tmp/openalpr.tar.gz -C /usr/local --strip-components=1

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
