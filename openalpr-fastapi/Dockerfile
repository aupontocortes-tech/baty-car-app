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

RUN apt-get update && apt-get install -y \
    openalpr \
    openalpr-daemon \
    openalpr-utils \
    libopenalpr-dev

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
