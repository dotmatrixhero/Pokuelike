/* 
 * File:   MapGenerator.cpp
 * Author: Brian
 * 
 * Created on July 23, 2012, 10:28 PM
 */

#include "MapGenerator.h"
using namespace std;

MapGenerator::MapGenerator() {
    ofstream myfile;
    myfile.open("mapgen.txt");
    myfile << "maptest";
}

MapGenerator::MapGenerator(const MapGenerator& orig) {
}

MapGenerator::~MapGenerator() {
}

