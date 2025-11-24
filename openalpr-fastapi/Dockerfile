FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config \
    python3 python3-pip \
    libopencv-dev libtesseract-dev libleptonica-dev liblog4cplus-dev libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/openalpr/openalpr.git /opt/openalpr
WORKDIR /opt/openalpr/src
RUN cmake . && make && make install && ldconfig
RUN mkdir -p /etc/openalpr && cp -r /opt/openalpr/runtime_data /etc/openalpr/runtime_data
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY main.py /app/main.py
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
ENV PORT=8000
EXPOSE 8000
CMD ["/app/start.sh"]
