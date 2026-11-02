export const SAMPLE_SCAN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<?xml-stylesheet href="file:///usr/bin/../share/nmap/nmap.xsl" type="text/xsl"?>
<nmaprun scanner="nmap" args="nmap -sV -sC --traceroute -oX lab-scan.xml 10.0.0.0/24 10.10.20.0/24" start="1761998400" version="7.95" xmloutputversion="1.05">
<scaninfo type="syn" protocol="tcp" numservices="1000" services="1,3-4,6-7,9,13,21-26"/>
<verbose level="1"/>
<debugging level="0"/>
<host starttime="1761998401" endtime="1761998462">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.1" addrtype="ipv4"/>
<address addr="F0:9F:C2:11:0A:44" addrtype="mac" vendor="Ubiquiti Inc"/>
<hostnames><hostname name="gw.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="9.6" extrainfo="Ubuntu Linux; protocol 2.0"/></port>
<port protocol="tcp" portid="53"><state state="open" reason="syn-ack"/><service name="domain" product="dnsmasq" version="2.90"/></port>
<port protocol="tcp" portid="80"><state state="open" reason="syn-ack"/><service name="http" product="lighttpd" version="1.4.69"/><script id="http-title" output="UniFi Network"/></port>
<port protocol="tcp" portid="443"><state state="open" reason="syn-ack"/><service name="ssl/http" tunnel="ssl" product="lighttpd" version="1.4.69"/></port>
</ports>
<os><osmatch name="Linux 5.4 - 5.15" accuracy="96"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.94" host="gw.lab.internal"/></trace>
</host>
<host starttime="1761998401" endtime="1761998471">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.5" addrtype="ipv4"/>
<address addr="00:11:32:4A:9C:01" addrtype="mac" vendor="Synology Incorporated"/>
<hostnames><hostname name="nas.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="9.6"/></port>
<port protocol="tcp" portid="139"><state state="open" reason="syn-ack"/><service name="netbios-ssn" product="Samba smbd" version="4.15.13"/></port>
<port protocol="tcp" portid="445"><state state="open" reason="syn-ack"/><service name="microsoft-ds" product="Samba smbd" version="4.15.13"/><script id="smb-security-mode" output="account_used: guest&#10;authentication_level: user&#10;message_signing: disabled"/></port>
<port protocol="tcp" portid="5000"><state state="open" reason="syn-ack"/><service name="upnp" product="Synology DSM"/><script id="http-title" output="Synology DiskStation"/></port>
</ports>
<os><osmatch name="Linux 4.15 - 5.8" accuracy="91"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.71"/></trace>
</host>
<host starttime="1761998401" endtime="1761998480">
<status state="up" reason="echo-reply"/>
<address addr="10.0.0.10" addrtype="ipv4"/>
<address addr="3C:52:82:1B:77:90" addrtype="mac" vendor="Hewlett Packard"/>
<hostnames><hostname name="build-01.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="8.9p1" extrainfo="Ubuntu Linux"/></port>
<port protocol="tcp" portid="2375"><state state="open" reason="syn-ack"/><service name="docker" version="24.0.7"/><script id="docker-version" output="Docker API exposed without TLS"/></port>
<port protocol="tcp" portid="8080"><state state="filtered" reason="no-response"/><service name="http-proxy"/></port>
</ports>
<os><osmatch name="Linux 5.0 - 5.14" accuracy="94"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.68"/></trace>
</host>
<host starttime="1761998401" endtime="1761998488">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.11" addrtype="ipv4"/>
<address addr="3C:52:82:1B:77:91" addrtype="mac" vendor="Hewlett Packard"/>
<hostnames><hostname name="git.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="8.9p1"/></port>
<port protocol="tcp" portid="3000"><state state="open" reason="syn-ack"/><service name="http" product="Gitea" version="1.21.4"/><script id="http-title" output="Gitea: Git with a cup of tea"/></port>
</ports>
<os><osmatch name="Linux 5.0 - 5.14" accuracy="93"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.73"/></trace>
</host>
<host starttime="1761998401" endtime="1761998495">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.20" addrtype="ipv4"/>
<address addr="00:1A:4B:22:81:0C" addrtype="mac" vendor="Dell Inc"/>
<hostnames><hostname name="db-01.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="8.9p1"/></port>
<port protocol="tcp" portid="3306"><state state="open" reason="syn-ack"/><service name="mysql" product="MySQL" version="8.0.36"/><script id="mysql-info" output="Protocol: 10&#10;Version: 8.0.36-0ubuntu0.22.04.1&#10;Thread ID: 91824"/></port>
</ports>
<os><osmatch name="Linux 4.15 - 6.1" accuracy="95"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.66"/></trace>
</host>
<host starttime="1761998401" endtime="1761998501">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.21" addrtype="ipv4"/>
<address addr="00:1A:4B:22:81:0D" addrtype="mac" vendor="Dell Inc"/>
<hostnames><hostname name="cache-01.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="8.9p1"/></port>
<port protocol="tcp" portid="6379"><state state="open" reason="syn-ack"/><service name="redis" version="7.0.15"/><script id="redis-info" output="redis_version:7.0.15&#10;os:Linux 6.2.0-39-generic x86_64&#10;protected-mode:no"/></port>
</ports>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.7"/></trace>
</host>
<host starttime="1761998401" endtime="1761998510">
<status state="up" reason="arp-response"/>
<address addr="10.0.0.30" addrtype="ipv4"/>
<address addr="00:1B:A9:5E:2F:77" addrtype="mac" vendor="Brother Industries"/>
<hostnames><hostname name="printer.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="80"><state state="open" reason="syn-ack"/><service name="http" product="Brother embedded HTTP"/></port>
<port protocol="tcp" portid="515"><state state="open" reason="syn-ack"/><service name="printer"/></port>
<port protocol="tcp" portid="631"><state state="open" reason="syn-ack"/><service name="ipp"/></port>
<port protocol="tcp" portid="9100"><state state="open" reason="syn-ack"/><service name="jetdirect"/></port>
</ports>
<os><osmatch name="Brother printer firmware" accuracy="88"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.81"/></trace>
</host>
<host starttime="1761998401" endtime="1761998516">
<status state="up" reason="echo-reply"/>
<address addr="10.0.0.40" addrtype="ipv4"/>
<hostnames><hostname name="ws-office.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="135"><state state="open" reason="syn-ack"/><service name="msrpc" product="Microsoft Windows RPC"/></port>
<port protocol="tcp" portid="3389"><state state="open" reason="syn-ack"/><service name="ms-wbt-server" product="Microsoft Terminal Services"/><script id="rdp-ntlm-info" output="Target_Name: LAB&#10;NetBIOS_Computer_Name: WS-OFFICE"/></port>
<port protocol="tcp" portid="445"><state state="open" reason="syn-ack"/><service name="microsoft-ds"/></port>
</ports>
<os><osmatch name="Microsoft Windows 11" accuracy="92"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.88"/></trace>
</host>
<host starttime="1761998401" endtime="1761998524">
<status state="up" reason="echo-reply"/>
<address addr="10.0.0.55" addrtype="ipv4"/>
<hostnames><hostname name="camera-north.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="554"><state state="open" reason="syn-ack"/><service name="rtsp" product="Hikvision IP camera"/></port>
<port protocol="tcp" portid="23"><state state="open" reason="syn-ack"/><service name="telnet" product="BusyBox telnetd"/><script id="telnet-encryption" output="Telnet is not encrypted"/></port>
</ports>
<os><osmatch name="embedded Linux" accuracy="85"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="1.1"/></trace>
</host>
<host starttime="1761998460" endtime="1761998601">
<status state="up" reason="echo-reply"/>
<address addr="10.10.20.1" addrtype="ipv4"/>
<hostnames><hostname name="edge-01.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="9.3"/></port>
<port protocol="tcp" portid="8443"><state state="open" reason="syn-ack"/><service name="ssl/http" tunnel="ssl" product="nginx" version="1.24.0"/></port>
</ports>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.9"/><hop ttl="2" ipaddr="10.0.0.254" rtt="3.4"/></trace>
</host>
<host starttime="1761998460" endtime="1761998610">
<status state="up" reason="echo-reply"/>
<address addr="10.10.20.14" addrtype="ipv4"/>
<hostnames><hostname name="vpn-01.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="443"><state state="open" reason="syn-ack"/><service name="ssl/http" tunnel="ssl" product="OpenVPN Access Server"/></port>
<port protocol="tcp" portid="1194"><state state="open|filtered" reason="no-response"/><service name="openvpn"/></port>
</ports>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.86"/><hop ttl="2" ipaddr="10.0.0.254" rtt="3.9"/></trace>
</host>
<host starttime="1761998460" endtime="1761998619">
<status state="up" reason="echo-reply"/>
<address addr="10.10.20.31" addrtype="ipv4"/>
<hostnames><hostname name="ci-runner.lab.internal" type="PTR"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack"/><service name="ssh" product="OpenSSH" version="9.3"/></port>
<port protocol="tcp" portid="8080"><state state="open" reason="syn-ack"/><service name="http" product="Jenkins" version="2.426.2"/><script id="http-title" output="Dashboard [Jenkins]"/></port>
</ports>
<os><osmatch name="Linux 5.15 - 6.5" accuracy="90"/></os>
<trace><hop ttl="1" ipaddr="10.0.0.1" rtt="0.92"/><hop ttl="2" ipaddr="10.0.0.254" rtt="4.1"/></trace>
</host>
<runstats><finished time="1761998620" timestr="Fri Nov  1 09:23:40 2026" elapsed="220.41" summary="Nmap done" exit="success"/><hosts up="12" down="0" total="12"/></runstats>
</nmaprun>`;

export const SAMPLE_FILE_NAME = 'lab-scan.xml';
