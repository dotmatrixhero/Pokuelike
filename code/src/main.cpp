#include <libtcod.hpp>
#include <cstdio>

#include "../include/Application.hpp"
#include "../include/StateIdentifiers.hpp"

int main(int argc, char* argv[])
{
    Application app;
    app.run(States::Test);

    return 0;
}
