#include <cstddef>
// #include <cstdint>
#include <cstring>
#include <vector>

#include "cc3d.hpp"

#include "wasm-wrapper/src/log.h"



struct Coord { int32_t x, y, z; };

const int32_t N { 1 };

Coord kernel2 []
{
	Coord { -N, -N, -N },
	Coord { -N, -N,  0 },
	Coord { -N, -N,  N },
	Coord { -N,  0, -N },
	Coord { -N,  0,  0 },
	Coord { -N,  0,  N },
	Coord { -N,  N, -N },
	Coord { -N,  N,  0 },
	Coord { -N,  N,  N },

	Coord {  0, -N, -N },
	Coord {  0, -N,  0 },
	Coord {  0, -N,  N },
	Coord {  0,  0, -N },
	// {  0,  0,  0 },
	Coord {  0,  0,  N },
	Coord {  0,  N, -N },
	Coord {  0,  N,  0 },
	Coord {  0,  N,  N },

	Coord {  N, -N, -N },
	Coord {  N, -N,  0 },
	Coord {  N, -N,  N },
	Coord {  N,  0, -N },
	Coord {  N,  0,  0 },
	Coord {  N,  0,  N },
	Coord {  N,  N, -N },
	Coord {  N,  N,  0 },
	Coord {  N,  N,  N },

	// // Coord { -N, -N, -N },
	// Coord { -N, -N,  0 },
	// // Coord { -N, -N,  N },
	// Coord { -N,  0, -N },
	// Coord { -N,  0,  0 },
	// Coord { -N,  0,  N },
	// // Coord { -N,  N, -N },
	// Coord { -N,  N,  0 },
	// // Coord { -N,  N,  N },

	// Coord {  0, -N, -N },
	// Coord {  0, -N,  0 },
	// Coord {  0, -N,  N },
	// Coord {  0,  0, -N },
	// // {  0,  0,  0 },
	// Coord {  0,  0,  N },
	// Coord {  0,  N, -N },
	// Coord {  0,  N,  0 },
	// Coord {  0,  N,  N },

	// // Coord {  N, -N, -N },
	// Coord {  N, -N,  0 },
	// // Coord {  N, -N,  N },
	// Coord {  N,  0, -N },
	// Coord {  N,  0,  0 },
	// Coord {  N,  0,  N },
	// // Coord {  N,  N, -N },
	// Coord {  N,  N,  0 },
	// // Coord {  N,  N,  N },
};

Coord kernel []
{
	// Coord { -N, -N, -N },
	Coord { -N, -N,  0 },
	// Coord { -N, -N,  N },
	// Coord { -N,  0, -N },
	Coord { -N,  0,  0 },
	// Coord { -N,  0,  N },
	// Coord { -N,  N, -N },
	Coord { -N,  N,  0 },
	// Coord { -N,  N,  N },

	// Coord {  0, -N, -N },
	Coord {  0, -N,  0 },
	// Coord {  0, -N,  N },
	// Coord {  0,  0, -N },
	// {  0,  0,  0 },
	// Coord {  0,  0,  N },
	// Coord {  0,  N, -N },
	Coord {  0,  N,  0 },
	// Coord {  0,  N,  N },

	// Coord {  N, -N, -N },
	Coord {  N, -N,  0 },
	// Coord {  N, -N,  N },
	// Coord {  N,  0, -N },
	Coord {  N,  0,  0 },
	// Coord {  N,  0,  N },
	// Coord {  N,  N, -N },
	Coord {  N,  N,  0 },
	// Coord {  N,  N,  N },
};

uint32_t* erode (uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	const size_t data_length { (sx + 1) * (sy + 1) * (sz + 1) };

	const size_t y_mul { (sx + 1) };
	const size_t z_mul { (sx + 1) * (sy + 1) };

	uint32_t* data_out { new uint32_t [data_length] {} };

	memcpy(data_out, data_in, data_length * 4);

	// LOG("sizeof(kernel2) / sizeof(Coord)", sizeof(kernel2) / sizeof(Coord))

	for (size_t x {}; x <= sx; ++x)
	for (size_t y {}; y <= sy; ++y)
	for (size_t z {}; z <= sz; ++z)
	{
		// data_out[x + (y * y_mul) + (z * z_mul)] = 1;
		// if (x > sx / 2)
		// {
		// 	data_out[x + (y * y_mul) + (z * z_mul)] = 2;
		// }
		// continue;
		if (data_out[x + (y * y_mul) + (z * z_mul)] == 0)
		{
			continue;
		}

		for (size_t i {}; i < sizeof(kernel2) / sizeof(Coord); ++i)
		{
			if (data_in[x + kernel2[i].x + ((y + kernel2[i].y) * y_mul) + ((z + kernel2[i].z) * z_mul)] == 0)
			{
				data_out[x + (y * y_mul) + (z * z_mul)] = 0;

				break;
			}
		}
	}

	// memset(data_out, 0, data_length * sizeof(uint32_t));

	// data_out[cx + (cy * y_mul) + (cz * z_mul)] = 1;

	return data_out;
}

uint32_t* dilate (uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	const size_t data_length { (sx + 1) * (sy + 1) * (sz + 1) };

	const size_t y_mul { (sx + 1) };
	const size_t z_mul { (sx + 1) * (sy + 1) };

	uint32_t* data_out { new uint32_t [data_length] {} };

	memcpy(data_out, data_in, data_length * 4);

	for (size_t x {}; x <= sx; ++x)
	for (size_t y {}; y <= sy; ++y)
	for (size_t z {}; z <= sz; ++z)
	{
		if (data_out[x + (y * y_mul) + (z * z_mul)] > 0)
		{
			continue;
		}

		for (size_t i {}; i < sizeof(kernel) / sizeof(Coord); ++i)
		{
			if (data_in[x + kernel[i].x + ((y + kernel[i].y) * y_mul) + ((z + kernel[i].z) * z_mul)] > 0)
			{
				data_out[x + (y * y_mul) + (z * z_mul)] = data_in[x + kernel[i].x + ((y + kernel[i].y) * y_mul) + ((z + kernel[i].z) * z_mul)];

				break;
			}
		}
	}

	return data_out;
}

uint32_t* invert (uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	const size_t data_length { sx * sy * sz };

	const size_t y_mul { (sx + 1) };
	const size_t z_mul { (sx + 1) * (sy + 1) };

	uint32_t* data_out { new uint32_t [data_length] {} };

	memcpy(data_out, data_in, data_length * 4);

	for (size_t x {}; x <= sx; ++x)
	for (size_t y {}; y <= sy; ++y)
	for (size_t z {}; z <= sz; ++z)
	{
		data_out[x + (y * y_mul) + (z * z_mul)] = 1 - data_out[x + (y * y_mul) + (z * z_mul)];
	}

	return data_out;
}

uint32_t* concomp (uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	return cc3d::connected_components3d<uint32_t>(data_in, sx + 1, sy + 1, sz + 1);
}

uint32_t* maincomp (uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	uint32_t* data_out = cc3d::connected_components3d<uint32_t>(data_in, sx + 1, sy + 1, sz + 1);

	const size_t y_mul { (sx + 1) };
	const size_t z_mul { (sx + 1) * (sy + 1) };

	uint32_t label { data_out[cx + (cy * y_mul) + (cz * z_mul)] };

	// LOG("label", (size_t) label)

	if (label != 0)
	{
		for (size_t x {}; x <= sx; ++x)
		for (size_t y {}; y <= sy; ++y)
		for (size_t z {}; z <= sz; ++z)
		{
			data_out[x + (y * y_mul) + (z * z_mul)] = (data_out[x + (y * y_mul) + (z * z_mul)] == label ? 1 : 0);
		}
	}
	else
	{
		for (size_t x {}; x <= sx; ++x)
		for (size_t y {}; y <= sy; ++y)
		for (size_t z {}; z <= sz; ++z)
		{
			data_out[x + (y * y_mul) + (z * z_mul)] = (data_out[x + (y * y_mul) + (z * z_mul)] ? 1 : 0);
		}
	}

	return data_out;
	// return data_in;
}

struct MorphOp
{
	using MorphOpFunc = uint32_t* (*) (uint32_t*, const size_t&, const size_t&, const size_t&, const size_t&, const size_t&, const size_t&);

	enum class Type : size_t
	{
		ERODE,
		DILATE,
		INVERT,
		CONCOMP,
		MAINCOMP,
	};

	constexpr static MorphOpFunc morph_op_func []
	{
		erode,
		dilate,
		invert,
		concomp,
		maincomp,
	};

	MorphOp::Type type {};

	size_t iteration_count { 1 };
};

uint32_t* performMorphOps (std::vector<MorphOp>& morph_ops, uint32_t* data_in, const size_t& sx, const size_t& sy, const size_t& sz, const size_t& cx, const size_t& cy, const size_t& cz)
{
	uint32_t* data_out {};

	uint32_t* data_out_prev {};

	for (auto morph_op : morph_ops)
	{
		for (size_t i {}; i < morph_op.iteration_count; ++i)
		{
			data_out = MorphOp::morph_op_func[(size_t) morph_op.type](data_in, sx, sy, sz, cx, cy, cz);

			if (data_out_prev)
			{
				delete [] data_out_prev;
			}

			data_out_prev = data_out;

			data_in = data_out;
		}
	}

	return data_out;
}

__attribute__((export_name("getConnectedComponents")))
void getConnectedComponents (uint32_t* labels, const size_t sx, const size_t sy, const size_t sz, const size_t data_length, const size_t cx, const size_t cy, const size_t cz, const size_t i_min, const size_t i_max, const size_t j_min, const size_t j_max, const size_t k_min, const size_t k_max)
{
	const size_t j_mul { sx };
	const size_t k_mul { sx * sy };

	uint32_t* labels_box_in = new uint32_t [(i_max - i_min + 1) * (j_max - j_min + 1) * (k_max - k_min + 1)] {};

	// for (size_t y { j_min }; y <= j_max; ++y)
	// for (size_t z { k_min }; z <= k_max; ++z)
	// {
	// 	memcpy(&labels_box_in[((y - j_min) * (i_max - i_min + 1)) + ((z - k_min) * (i_max - i_min + 1) * (j_max - j_min + 1))], &labels[i_min + (y * y_mul) + (z * z_mul)], (i_max - i_min + 1) * 4);
	// }

	for (size_t i { i_min }; i <= i_max; ++i)
	for (size_t j { j_min }; j <= j_max; ++j)
	for (size_t k { k_min }; k <= k_max; ++k)
	{
		labels_box_in[(i - i_min) + ((j - j_min) * (i_max - i_min + 1)) + ((k - k_min) * (i_max - i_min + 1) * (j_max - j_min + 1))] = labels[i + (j * j_mul) + (k * k_mul)];
	}

	auto morph_ops
	{
		std::vector<MorphOp>
		{
			{ MorphOp::Type::ERODE, 1 },
			{ MorphOp::Type::MAINCOMP, 1 },
			// { MorphOp::Type::ERODE, 1 },
			// { MorphOp::Type::DILATE, 2 },
			// { MorphOp::Type::DILATE, 1 },
			// { MorphOp::Type::INVERT, 1 },
			// { MorphOp::Type::CONCOMP, 1 },
			// { MorphOp::Type::ERODE, 4 },
			// { MorphOp::Type::MAINCOMP, 1 },
			// { MorphOp::Type::DILATE, 3 },
		}
	};

	uint32_t* labels_box_out =
		performMorphOps
		(
			morph_ops,

			labels_box_in,

			// i_max - i_min + 1, j_max - j_min + 1, k_max - k_min + 1,
			i_max - i_min, j_max - j_min, k_max - k_min,

			cx - i_min, cy - j_min, cz - k_min
		);

	if (labels_box_out)
	{
		// for (size_t y { j_min }; y <= j_max; ++y)
		// for (size_t z { k_min }; z <= k_max; ++z)
		// {
		// 	memcpy(&labels[i_min + (y * y_mul) + (z * z_mul)], &labels_box_out[((y - j_min) * (i_max - i_min + 1)) + ((z - k_min) * (i_max - i_min + 1) * (j_max - j_min + 1))], (i_max - i_min + 1) * 4);
		// }

		for (size_t i { i_min }; i <= i_max; ++i)
		for (size_t j { j_min }; j <= j_max; ++j)
		for (size_t k { k_min }; k <= k_max; ++k)
		{
			labels[i + (j * j_mul) + (k * k_mul)] = labels_box_out[(i - i_min) + ((j - j_min) * (i_max - i_min + 1)) + ((k - k_min) * (i_max - i_min + 1) * (j_max - j_min + 1))];
		}
	}

	delete [] labels_box_out;
	delete [] labels_box_in;
}
