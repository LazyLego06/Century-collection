import streamlit as st

# 1. THE DATA - Updated with "Hotlink-Friendly" Image URLs
rare_cars = [
    {
        "name": "Mercedes-Benz 300 SLR", 
        "price": 142000000, 
        "year": 1955, 
        "origin": "Germany",
        "engine": "3.0L Straight-8",
        "top_speed": "180 mph",
        "fact": "The 'Uhlenhaut Coupé' is the most expensive car ever sold. It was basically a street-legal Formula 1 car.",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Mercedes-Benz_300_SLR_Uhlenhaut-Coup%C3%A9.jpg/1200px-Mercedes-Benz_300_SLR_Uhlenhaut-Coup%C3%A9.jpg"
    },
    {
        "name": "Ferrari 250 GTO", 
        "price": 70000000, 
        "year": 1962, 
        "origin": "Italy",
        "engine": "3.0L Colombo V12",
        "top_speed": "174 mph",
        "fact": "Only 36 were ever made. To buy one originally, Enzo Ferrari had to personally approve you.",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/1963_Ferrari_250_GTO_3%2C0_Litre_V12_Series_I.jpg/1200px-1963_Ferrari_250_GTO_3%2C0_Litre_V12_Series_I.jpg"
    },
    {
        "name": "Bugatti Type 57SC Atlantic", 
        "price": 40000000, 
        "year": 1936, 
        "origin": "France",
        "engine": "3.3L Straight-8 Supercharged",
        "top_speed": "125 mph",
        "fact": "The body is made of Elektron (magnesium/aluminum), which was so flammable they had to rivet the seams on the outside.",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/1936_Bugatti_Type_57SC_Atlantic_at_Mullin_Museum.jpg/1200px-1936_Bugatti_Type_57SC_Atlantic_at_Mullin_Museum.jpg"
    },
    {
        "name": "Rolls-Royce Boat Tail", 
        "price": 28000000, 
        "year": 2021, 
        "origin": "UK",
        "engine": "6.75L Twin-Turbo V12",
        "top_speed": "155 mph (limited)",
        "fact": "The rear deck opens like butterfly wings to reveal a 'hosting suite' with a parasol and champagne fridge.",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Rolls_Royce_Boat_Tail.jpg/1200px-Rolls_Royce_Boat_Tail.jpg"
    },
    {
        "name": "Aston Martin DBR1", 
        "price": 22500000, 
        "year": 1956, 
        "origin": "UK",
        "engine": "3.0L Straight-6",
        "top_speed": "155 mph",
        "fact": "This is the car that won Le Mans in 1959. It's the most expensive British car ever sold at auction.",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/1956_Aston_Martin_DBR1_at_Goodwood.jpg/1200px-1956_Aston_Martin_DBR1_at_Goodwood.jpg"
    },
    {"name": "McLaren F1 LM", "price": 19800000, "year": 1995, "origin": "UK"},
    {"name": "Pagani Zonda HP Barchetta", "price": 17500000, "year": 2017, "origin": "Italy"},
    {"name": "Ferrari 250 Testa Rossa", "price": 16400000, "year": 1957, "origin": "Italy"},
    {"name": "Porsche 917", "price": 14000000, "year": 1970, "origin": "Germany"},
    {"name": "Jaguar XK120-C", "price": 13200000, "year": 1953, "origin": "UK"},
    {"name": "Alfa Romeo Tipo 33 Stradale", "price": 10000000, "year": 1967, "origin": "Italy"},
    {"name": "Ford GT40 Mk II", "price": 9800000, "year": 1966, "origin": "USA"},
    {"name": "Bugatti Centodieci", "price": 9000000, "year": 2022, "origin": "France"},
    {"name": "Mercedes-Maybach Exelero", "price": 8000000, "year": 2004, "origin": "Germany"},
    {"name": "Pagani Huayra Tricolore", "price": 6700000, "year": 2021, "origin": "Italy"},
    {"name": "Shelby Cobra 427 Super Snake", "price": 5500000, "year": 1966, "origin": "USA"},
    {"name": "Ferrari LaFerrari Aperta", "price": 5000000, "year": 2016, "origin": "Italy"},
    {"name": "Koenigsegg CCXR Trevita", "price": 4800000, "year": 2009, "origin": "Sweden"},
    {"name": "Lamborghini Veneno Roadster", "price": 4500000, "year": 2014, "origin": "Italy"},
    {"name": "Bugatti Chiron Super Sport", "price": 3900000, "year": 2022, "origin": "France"},
    {"name": "McLaren P1 LM", "price": 3700000, "year": 2016, "origin": "UK"},
    {"name": "Lykan Hypersport", "price": 3400000, "year": 2013, "origin": "UAE"},
    {"name": "Aston Martin Valkyrie", "price": 3200000, "year": 2022, "origin": "UK"},
    {"name": "Gordon Murray T.50", "price": 3000000, "year": 2022, "origin": "UK"},
    {"name": "Rimac Nevera", "price": 2400000, "year": 2021, "origin": "Croatia"},
    {"name": "Lamborghini Sesto Elemento", "price": 2200000, "year": 2011, "origin": "Italy"},
    {"name": "Pininfarina Battista", "price": 2200000, "year": 2022, "origin": "Italy"},
    {"name": "Hennessey Venom F5", "price": 2100000, "year": 2021, "origin": "USA"},
    {"name": "Ferrari Enzo", "price": 3000000, "year": 2002, "origin": "Italy"},
    {"name": "Porsche 918 Spyder", "price": 845000, "year": 2013, "origin": "Germany"},
    {"name": "Lexus LFA Nurburgring", "price": 1100000, "year": 2012, "origin": "Japan"},
    {"name": "Nissan Skyline GT-R Z-Tune", "price": 500000, "year": 2003, "origin": "Japan"},
    {"name": "Toyota 2000GT", "price": 1200000, "year": 1967, "origin": "Japan"},
    {"name": "De Tomaso P72", "price": 1300000, "year": 2022, "origin": "Italy"},
    {"name": "Apollo IE", "price": 2700000, "year": 2019, "origin": "Germany"},
    {"name": "Maserati MC12", "price": 2000000, "year": 2004, "origin": "Italy"},
    {"name": "Vector W8", "price": 450000, "year": 1989, "origin": "USA"},
    {"name": "Saleen S7 Twin Turbo", "price": 600000, "year": 2005, "origin": "USA"},
    {"name": "Koenigsegg Jesko", "price": 3000000, "year": 2021, "origin": "Sweden"},
    {"name": "Zenvo TS1 GT", "price": 1900000, "year": 2016, "origin": "Denmark"},
    {"name": "Ferrari F40", "price": 2000000, "year": 1987, "origin": "Italy"},
    {"name": "Ferrari F50", "price": 4000000, "year": 1995, "origin": "Italy"},
    {"name": "Lamborghini Miura SV", "price": 3500000, "year": 1971, "origin": "Italy"},
    {"name": "Porsche Carrera GT", "price": 1500000, "year": 2003, "origin": "Germany"},
    {"name": "Bugatti EB110 SS", "price": 3000000, "year": 1992, "origin": "France"},
    {"name": "Duesenberg Model J", "price": 1000000, "year": 1928, "origin": "USA"},
    {"name": "Tucker 48", "price": 2000000, "year": 1948, "origin": "USA"},
    {"name": "Delahaye 135MS", "price": 6000000, "year": 1938, "origin": "France"},
    {"name": "Talbot-Lago T150C SS", "price": 4000000, "year": 1937, "origin": "France"},
    {"name": "Ferrari 288 GTO", "price": 3500000, "year": 1984, "origin": "Italy"},
    {"name": "McLaren Speedtail", "price": 2250000, "year": 2020, "origin": "UK"},
    {"name": "Bugatti Divo", "price": 5800000, "year": 2019, "origin": "France"},
    {"name": "Lamborghini Countach LPI 800-4", "price": 2600000, "year": 2022, "origin": "Italy"},
    {"name": "Ferrari Daytona SP3", "price": 2200000, "year": 2022, "origin": "Italy"},
    {"name": "Aston Martin One-77", "price": 1800000, "year": 2009, "origin": "UK"},
    {"name": "Pagani Zonda Cinque", "price": 2000000, "year": 2009, "origin": "Italy"},
    {"name": "Koenigsegg Agera RS", "price": 2500000, "year": 2015, "origin": "Sweden"},
    {"name": "Gumpert Apollo", "price": 450000, "year": 2005, "origin": "Germany"},
    {"name": "Spyker C8 Laviolette", "price": 350000, "year": 2001, "origin": "Netherlands"},
    {"name": "Noble M600", "price": 330000, "year": 2010, "origin": "UK"},
    {"name": "TVR Sagaris", "price": 100000, "year": 2005, "origin": "UK"},
    {"name": "Ascari A10", "price": 650000, "year": 2006, "origin": "UK"},
    {"name": "Oldsmobile F-88", "price": 3240000, "year": 1954, "origin": "USA"},
    {"name": "Plymouth Hemi Cuda Convertible", "price": 3500000, "year": 1971, "origin": "USA"},
    {"name": "Pontiac GTO Judge", "price": 200000, "year": 1969, "origin": "USA"},
    {"name": "Chevrolet Corvette L88", "price": 3800000, "year": 1967, "origin": "USA"},
    {"name": "Buick GNX", "price": 200000, "year": 1987, "origin": "USA"},
    {"name": "Dodge Charger Daytona", "price": 900000, "year": 1969, "origin": "USA"},
    {"name": "Jaguar E-Type Lightweight", "price": 7000000, "year": 1963, "origin": "UK"},
    {"name": "Aston Martin DB5", "price": 1000000, "year": 1963, "origin": "UK"},
    {"name": "Lotus Esprit S1", "price": 150000, "year": 1976, "origin": "UK"},
    {"name": "Bentley Blower", "price": 7000000, "year": 1929, "origin": "UK"},
    {"name": "Bugatti Veyron Super Sport", "price": 2400000, "year": 2010, "origin": "France"},
    {"name": "Maybach 62 Landaulet", "price": 1300000, "year": 2008, "origin": "Germany"},
    {"name": "Audi Sport Quattro S1", "price": 500000, "year": 1985, "origin": "Germany"},
    {"name": "BMW M1", "price": 600000, "year": 1978, "origin": "Germany"},
    {"name": "Lancia Stratos HF", "price": 600000, "year": 1973, "origin": "Italy"},
    {"name": "Lamborghini Reventon", "price": 1500000, "year": 2007, "origin": "Italy"},
    {"name": "Ferrari 250 GT SWB", "price": 10000000, "year": 1960, "origin": "Italy"},
    {"name": "Maserati A6GCS/53", "price": 4000000, "year": 1953, "origin": "Italy"},
    {"name": "Iso Grifo", "price": 400000, "year": 1965, "origin": "Italy"},
    {"name": "Bizzarrini 5300 GT", "price": 1000000, "year": 1964, "origin": "Italy"},
    {"name": "Facel Vega HK500", "price": 200000, "year": 1958, "origin": "France"},
    {"name": "Alpine A110", "price": 100000, "year": 1961, "origin": "France"},
    {"name": "Citroen SM", "price": 60000, "year": 1970, "origin": "France"},
    {"name": "Matra Djet", "price": 40000, "year": 1962, "origin": "France"},
    {"name": "Honda NSX-R", "price": 300000, "year": 1992, "origin": "Japan"},
    {"name": "Mazda Cosmo Sport", "price": 150000, "year": 1967, "origin": "Japan"},
    {"name": "Subaru Impreza 22B STi", "price": 300000, "year": 1998, "origin": "Japan"},
    {"name": "Mitsubishi Lancer Evolution VI TME", "price": 150000, "year": 2000, "origin": "Japan"},
    {"name": "Shelby Daytona Coupe", "price": 7000000, "year": 1964, "origin": "USA"},
    {"name": "Cunningham C3", "price": 1000000, "year": 1952, "origin": "USA"},
    {"name": "Chaparral 2E", "price": 2000000, "year": 1966, "origin": "USA"},
    {"name": "Panoz Esperante GTR-1", "price": 900000, "year": 1997, "origin": "USA"},
    {"name": "Donkervoort D8 GTO", "price": 200000, "year": 2013, "origin": "Netherlands"},
    {"name": "W Motors Fenyr Supersport", "price": 1900000, "year": 2017, "origin": "UAE"},
    {"name": "Laraki Epitome", "price": 2000000, "year": 2013, "origin": "Morocco"},
    {"name": "Hispano-Suiza Carmen", "price": 1700000, "year": 2019, "origin": "Spain"},
    {"name": "Tatra T87", "price": 150000, "year": 1936, "origin": "Czech Republic"},
    {"name": "Saab 92", "price": 30000, "year": 1949, "origin": "Sweden"}
]

# 2. WEBSITE INTERFACE
st.set_page_config(page_title="The Century Collection", page_icon="🏎️", layout="wide")

st.title("🏎️ The Century Collection")
st.subheader("Automotive Legends Curator")

# Search and Sidebar
query = st.text_input("Search for a car (Name, Year, or Country):", "").title()
sort_by = st.sidebar.selectbox("Sort by Price:", ["Highest First", "Lowest First"])

# Filter Logic
results = [c for c in rare_cars if query in c["name"] or query in c["origin"] or query in str(c["year"])]

# Sorting Logic
is_reverse = True if sort_by == "Highest First" else False
results = sorted(results, key=lambda x: x["price"], reverse=is_reverse)

# Display Results
if results:
    st.write(f"Displaying **{len(results)}** Legends")
    for car in results:
        with st.expander(f"✨ {car['name']} ({car['year']})"):
            col1, col2 = st.columns([1, 1.2]) 
            
            with col1:
                st.write(f"💰 **Value:** ${car['price']:,}")
                st.write(f"📍 **Origin:** {car['origin']}")
                
                if "engine" in car:
                    st.write(f"⚙️ **Engine:** {car['engine']}")
                if "top_speed" in car:
                    st.write(f"🏎️ **Top Speed:** {car['top_speed']}")
                if "fact" in car:
                    st.info(f"**Legendary Fact:** {car['fact']}")
            
            with col2:
                if "image" in car:
                    # Using Markdown HTML to force the browser to try harder to load it
                    st.markdown(
                        f'<img src="{car["image"]}" style="width:100%; border-radius:10px;">', 
                        unsafe_allow_html=True
                    )
                else:
                    st.warning("📷 Image & stats coming soon!")
else:
    st.error("No matches found. Try another search!")