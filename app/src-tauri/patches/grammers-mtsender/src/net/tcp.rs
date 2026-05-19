// Copyright 2020 - developers of the `grammers` project.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// https://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or https://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

use log::info;
use tokio::net::TcpStream;
pub use tokio::net::tcp::{ReadHalf, WriteHalf};

use super::ServerAddr;

pub enum NetStream {
    Tcp(TcpStream),
    #[cfg(feature = "proxy")]
    ProxySocks5(tokio_socks::tcp::Socks5Stream<TcpStream>),
}

impl NetStream {
    pub(crate) fn split(&mut self) -> (ReadHalf<'_>, WriteHalf<'_>) {
        match self {
            Self::Tcp(stream) => stream.split(),
            #[cfg(feature = "proxy")]
            Self::ProxySocks5(stream) => stream.split(),
        }
    }

    pub(crate) async fn connect(addr: &ServerAddr) -> Result<Self, std::io::Error> {
        info!("connecting...");
        match addr {
            ServerAddr::Tcp { address } => Ok(NetStream::Tcp(TcpStream::connect(address).await?)),
            #[cfg(feature = "proxy")]
            ServerAddr::Proxied { address, proxy } => {
                Self::connect_proxy_stream(address, proxy).await
            }
        }
    }

    #[cfg(feature = "proxy")]
    async fn connect_proxy_stream(
        addr: &std::net::SocketAddr,
        proxy_url: &str,
    ) -> Result<NetStream, std::io::Error> {
        use std::{
            io::{self, ErrorKind},
            net::{IpAddr, SocketAddr},
        };

        use hickory_resolver::Resolver;
        use url::Host;

        let proxy = url::Url::parse(proxy_url)
            .map_err(|err| io::Error::new(ErrorKind::InvalidData, err))?;
        let scheme = proxy.scheme();
        let host = proxy.host().ok_or(io::Error::new(
            ErrorKind::NotFound,
            format!("proxy host is missing from url: {}", proxy_url),
        ))?;
        let port = proxy.port().ok_or(io::Error::new(
            ErrorKind::NotFound,
            format!("proxy port is missing from url: {}", proxy_url),
        ))?;
        let username = proxy.username();
        let password = proxy.password().unwrap_or("");
        let proxy_addr = match host {
            Host::Domain(domain) => {
                let resolver = Resolver::builder_tokio().unwrap().build();
                let response = resolver.lookup_ip(domain).await?;
                let ip_addr = response.into_iter().next().ok_or(io::Error::new(
                    ErrorKind::NotFound,
                    format!("proxy host did not return any ip address: {}", domain),
                ))?;
                SocketAddr::new(ip_addr, port)
            }
            Host::Ipv4(v4) => SocketAddr::new(IpAddr::from(v4), port),
            Host::Ipv6(v6) => SocketAddr::new(IpAddr::from(v6), port),
        };

        match scheme {
            "socks5" => {
                if username.is_empty() {
                    Ok(NetStream::ProxySocks5(
                        tokio_socks::tcp::Socks5Stream::connect(proxy_addr, addr)
                            .await
                            .map_err(|err| io::Error::new(ErrorKind::ConnectionAborted, err))?,
                    ))
                } else {
                    Ok(NetStream::ProxySocks5(
                        tokio_socks::tcp::Socks5Stream::connect_with_password(
                            proxy_addr, addr, username, password,
                        )
                        .await
                        .map_err(|err| io::Error::new(ErrorKind::ConnectionAborted, err))?,
                    ))
                }
            }
            "http" | "https" => {
                Self::connect_http_proxy(proxy_addr, addr, username, password).await
            }
            scheme => Err(io::Error::new(
                ErrorKind::ConnectionAborted,
                format!("proxy scheme not supported: {}", scheme),
            )),
        }
    }

    #[cfg(feature = "proxy")]
    async fn connect_http_proxy(
        proxy_addr: std::net::SocketAddr,
        target_addr: &std::net::SocketAddr,
        username: &str,
        password: &str,
    ) -> Result<NetStream, std::io::Error> {
        use std::io::{self, ErrorKind};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        info!("connecting via HTTP CONNECT proxy to {}", target_addr);

        let mut stream = TcpStream::connect(proxy_addr).await?;

        let connect_req = if username.is_empty() {
            format!(
                "CONNECT {} HTTP/1.1\r\nHost: {}\r\n\r\n",
                target_addr, target_addr
            )
        } else {
            use base64::{Engine as _, engine::general_purpose::STANDARD};
            let credentials = STANDARD.encode(format!("{}:{}", username, password));
            format!(
                "CONNECT {} HTTP/1.1\r\nHost: {}\r\nProxy-Authorization: Basic {}\r\n\r\n",
                target_addr, target_addr, credentials
            )
        };

        stream.write_all(connect_req.as_bytes()).await?;

        let mut buf = vec![0u8; 4096];
        let mut total = 0;
        loop {
            if total >= buf.len() {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    "HTTP CONNECT response too large",
                ));
            }
            let n = stream.read(&mut buf[total..]).await?;
            if n == 0 {
                return Err(io::Error::new(
                    ErrorKind::UnexpectedEof,
                    "proxy closed connection during CONNECT handshake",
                ));
            }
            total += n;
            if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }

        let response = String::from_utf8_lossy(&buf[..total]);
        let status_line = response.lines().next().unwrap_or("");

        if !status_line.contains("200") {
            return Err(io::Error::new(
                ErrorKind::ConnectionRefused,
                format!("HTTP CONNECT failed: {}", status_line),
            ));
        }

        info!("HTTP CONNECT tunnel established to {}", target_addr);
        Ok(NetStream::Tcp(stream))
    }
}
