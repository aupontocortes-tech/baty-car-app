FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive

# Dependências de sistema e bibliotecas necessárias
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    cmake \
    build-essential \
    libopencv-dev \
    libleptonica-dev \
    libtesseract-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    liblog4cplus-dev \
    libcurl4-openssl-dev \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Compila e instala o OpenALPR a partir do código-fonte
RUN git clone https://github.com/openalpr/openalpr.git /tmp/openalpr && \
    cd /tmp/openalpr/src && mkdir build && cd build && \
    cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_INSTALL_SYSCONFDIR:PATH=/etc .. && \
    make -j$(nproc) && \
    make install && \
    rm -rf /tmp/openalpr

WORKDIR /app

COPY requirements.txt /app/
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
